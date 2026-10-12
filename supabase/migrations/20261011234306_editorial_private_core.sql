-- CLI migration candidate generated 2026-10-11 with `supabase migration new`.
-- NOT APPLIED to Supabase or to the local Supabase stack; validated only with PGlite.
-- Target: PostgreSQL 15+ em Supabase. Nenhum objeto em public/auth/storage/realtime.
-- Schema editorial permanece FORA dos exposed schemas; Data API desativada no MVP.
-- Confirmar roles/configuração reais antes de a equipa aplicar a qualquer projeto.
-- LOGIN/credencial backend, configurações Auth, buckets e grant do papel ao LOGIN
-- serão provisionados separadamente. Não há secret, senha ou service_role no browser.
BEGIN;
CREATE SCHEMA IF NOT EXISTS editorial;
REVOKE ALL ON SCHEMA editorial FROM PUBLIC, anon, authenticated, service_role;
DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'zaniratti_editorial_backend') THEN
    CREATE ROLE zaniratti_editorial_backend NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
  END IF;
END $$;
GRANT USAGE ON SCHEMA editorial TO zaniratti_editorial_backend;
ALTER DEFAULT PRIVILEGES IN SCHEMA editorial REVOKE ALL ON TABLES FROM PUBLIC, anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA editorial REVOKE ALL ON SEQUENCES FROM PUBLIC, anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA editorial REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC, anon, authenticated, service_role;

CREATE TYPE editorial.disclosure AS ENUM ('restricted','candidate','approved');
CREATE TYPE editorial.interpretation AS ENUM ('preferred','alternative','disputed','annotation');
CREATE TYPE editorial.life_status AS ENUM ('living','deceased','unknown');

-- Identificador da identidade; nomes, datas e lugares são afirmações independentes.
CREATE TABLE editorial.person (
 id text PRIMARY KEY CHECK (id ~ '^[a-z0-9][a-z0-9_-]*$'),
 legacy_id text UNIQUE,
 life_status editorial.life_status NOT NULL DEFAULT 'unknown',
 disclosure editorial.disclosure NOT NULL DEFAULT 'restricted',
 revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE editorial.branch (
 id text PRIMARY KEY, title_pt text NOT NULL, title_it text,
 description_private text NOT NULL DEFAULT '',
 disclosure editorial.disclosure NOT NULL DEFAULT 'restricted'
);
CREATE TABLE editorial.person_branch (
 person_id text NOT NULL REFERENCES editorial.person(id),
 branch_id text NOT NULL REFERENCES editorial.branch(id),
 PRIMARY KEY(person_id,branch_id)
);
-- FAM do GEDCOM pode ser agrupamento parental, sem afirmar união ou casamento.
CREATE TABLE editorial.family_group (
 id text PRIMARY KEY, legacy_id text UNIQUE,
 kind text NOT NULL CHECK(kind IN ('parental_group','union')),
 note_private text NOT NULL DEFAULT '',
 disclosure editorial.disclosure NOT NULL DEFAULT 'restricted'
);
CREATE TABLE editorial.group_participant (
 group_id text NOT NULL REFERENCES editorial.family_group(id),
 person_id text NOT NULL REFERENCES editorial.person(id),
 role text NOT NULL CHECK(role IN ('parent','partner','child','other')),
 PRIMARY KEY(group_id,person_id,role)
);
CREATE TABLE editorial.event (
 id text PRIMARY KEY,
 type text NOT NULL CHECK(type IN ('birth','death','marriage','migration','residence','other')),
 person_id text REFERENCES editorial.person(id),
 group_id text REFERENCES editorial.family_group(id),
 disclosure editorial.disclosure NOT NULL DEFAULT 'restricted',
 CHECK(num_nonnulls(person_id,group_id)=1)
);
-- Os bytes ficam no acervo privado. Mesmo hash pode ter várias referências.
CREATE TABLE editorial.original_object (
 sha256 text PRIMARY KEY CHECK(sha256 ~ '^[0-9a-f]{64}$'),
 private_locator text NOT NULL,
 mime text NOT NULL, bytes bigint NOT NULL CHECK(bytes >= 0),
 provenance_kind text NOT NULL CHECK(provenance_kind IN ('archive_payload','received_original','received_transcription','derived_local')),
 received_at timestamptz,
 note_private text NOT NULL DEFAULT ''
);
CREATE TABLE editorial.source (
 id text PRIMARY KEY,
 title_private text NOT NULL,
 kind text NOT NULL CHECK(kind IN ('provided_document','historic_site','family_testimony','archive_document','secondary_work','other')),
 original_url_private text,
 disclosure editorial.disclosure NOT NULL DEFAULT 'restricted',
 independence_group text, -- P2 páginas 2/4 podem referir ao MESMO ato
 note_private text NOT NULL DEFAULT ''
);
CREATE TABLE editorial.source_object (
 source_id text NOT NULL REFERENCES editorial.source(id),
 object_sha256 text NOT NULL REFERENCES editorial.original_object(sha256),
 PRIMARY KEY(source_id,object_sha256)
);
-- Ocorrência/inventário separado do conteúdo: várias capturas/recebimentos podem
-- apontar aos mesmos bytes. Registro sem bytes preserva negativa/lacuna delimitada.
CREATE TABLE editorial.capture_occurrence (
 id text PRIMARY KEY,
 source_id text REFERENCES editorial.source(id),
 object_sha256 text REFERENCES editorial.original_object(sha256),
 origin_kind text NOT NULL CHECK(origin_kind IN ('wayback','commoncrawl','other_archive','received','local_derivation','live_web')),
 original_url_private text,
 origin_locator_private text NOT NULL,
 replay_url_private text,
 capture_timestamp text,
 capture_precision text NOT NULL DEFAULT 'unknown' CHECK(capture_precision IN ('exact','date','inferred','unknown')),
 retrieved_at timestamptz,
 retrieval_event_private text NOT NULL DEFAULT '',
 indexed_mime text,
 http_status integer CHECK(http_status BETWEEN 100 AND 599),
 indexed_digest text,
 expected_payload_sha256 text CHECK(expected_payload_sha256 ~ '^[0-9a-f]{64}$'),
 recovery_state text NOT NULL CHECK(recovery_state IN ('indexed_only','recovered','missing','failed','received','derived')),
 index_record_private jsonb,
 note_private text NOT NULL DEFAULT '',
 CHECK(recovery_state NOT IN ('recovered','received','derived') OR object_sha256 IS NOT NULL)
);
CREATE TABLE editorial.assertion (
 id text PRIMARY KEY,
 subject_person_id text REFERENCES editorial.person(id),
 subject_group_id text REFERENCES editorial.family_group(id),
 subject_event_id text REFERENCES editorial.event(id),
 target_person_id text REFERENCES editorial.person(id),
 predicate text NOT NULL, -- vocabulário no contrato/app, sem inferir casamento
 value_literal text NOT NULL DEFAULT '',
 date_value jsonb, -- literal/qualificador/precisão/componentes; sem fake 01/01
 interpretation editorial.interpretation NOT NULL DEFAULT 'annotation',
 evidence_class text NOT NULL, -- preserva classes originais; não converte em percentuais
 disclosure editorial.disclosure NOT NULL DEFAULT 'restricted',
 note_private text NOT NULL DEFAULT '',
 revision integer NOT NULL DEFAULT 1 CHECK(revision > 0),
 CHECK(num_nonnulls(subject_person_id,subject_group_id,subject_event_id)=1),
 CHECK(target_person_id IS NULL OR subject_person_id IS DISTINCT FROM target_person_id),
 CHECK(predicate NOT IN ('parent_of','partner_of','caregiver_of') OR
       (subject_person_id IS NOT NULL AND target_person_id IS NOT NULL)),
 CHECK(date_value IS NULL OR jsonb_typeof(date_value)='object')
);
-- Toda afirmação exportada precisa de >=1 citação. Regra checada no exportador:
-- SQL simples não pode impor cardinalidade de filho com CHECK entre tabelas.
CREATE TABLE editorial.citation (
 id text PRIMARY KEY,
 assertion_id text NOT NULL REFERENCES editorial.assertion(id),
 source_id text NOT NULL REFERENCES editorial.source(id),
 capture_id text REFERENCES editorial.capture_occurrence(id),
 evidence_role text NOT NULL DEFAULT 'support' CHECK(evidence_role IN ('support','challenge','context')),
 locator text NOT NULL DEFAULT '',
 quote_private text,
 translation_private text,
 language text,
 disclosure editorial.disclosure NOT NULL DEFAULT 'restricted'
);
CREATE TABLE editorial.publication_decision (
 id text PRIMARY KEY,
 target_type text NOT NULL CHECK(target_type IN ('person','assertion','source','derivative','translation','release')),
 target_id text NOT NULL,
 scope text NOT NULL CHECK(scope IN ('metadata','fact','image','full_copy','translation','release')),
 outcome text NOT NULL CHECK(outcome IN ('pending','approved','rejected','withdrawn')),
 authorized_basis_private text NOT NULL,
 reviewed_by_private text NOT NULL,
 reviewed_at timestamptz NOT NULL DEFAULT now(),
 expires_at timestamptz,
 public_note text
);
-- Autorização/consentimento é documento restrito; só derivado aprovado pode sair.
CREATE TABLE editorial.derivative (
 id text PRIMARY KEY,
 original_sha256 text NOT NULL REFERENCES editorial.original_object(sha256),
 sha256 text NOT NULL UNIQUE CHECK(sha256 ~ '^[0-9a-f]{64}$'),
 private_locator text NOT NULL,
 mime text NOT NULL, bytes bigint NOT NULL CHECK(bytes>=0),
 recipe_private text NOT NULL,
 disclosure editorial.disclosure NOT NULL DEFAULT 'restricted',
 decision_id text REFERENCES editorial.publication_decision(id)
);
CREATE TABLE editorial.editor_member (
 user_id uuid PRIMARY KEY,
 role text NOT NULL CHECK(role IN ('editor','reviewer','publisher')),
 active boolean NOT NULL DEFAULT false,
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE editorial.review (
 id text PRIMARY KEY,
 target_type text NOT NULL, target_id text NOT NULL,
 target_revision integer NOT NULL CHECK(target_revision>0),
 review_type text NOT NULL CHECK(review_type IN ('fact','disclosure','translation','release')),
 outcome text NOT NULL CHECK(outcome IN ('pending','approved','changes_requested','rejected')),
 reviewer_private text NOT NULL,
 note_private text NOT NULL DEFAULT '',
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE editorial.release (
 id text PRIMARY KEY,
 state text NOT NULL DEFAULT 'candidate' CHECK(state IN ('candidate','approved','published','withdrawn')),
 corpus_sha256 text NOT NULL CHECK(corpus_sha256 ~ '^[0-9a-f]{64}$'),
 snapshot_sha256 text CHECK(snapshot_sha256 ~ '^[0-9a-f]{64}$'),
 created_at timestamptz NOT NULL DEFAULT now(),
 approved_at timestamptz, published_at timestamptz,
 private_manifest_locator text,
 public_changelog text NOT NULL DEFAULT '',
 CHECK(state NOT IN ('approved','published') OR (approved_at IS NOT NULL AND snapshot_sha256 IS NOT NULL)),
 CHECK(state <> 'published' OR published_at IS NOT NULL)
);
CREATE TABLE editorial.release_item (
 release_id text NOT NULL REFERENCES editorial.release(id),
 type text NOT NULL CHECK(type IN ('person','assertion','source','citation','derivative')),
 object_id text NOT NULL,
 revision integer NOT NULL CHECK(revision>0),
 projected_public_value jsonb NOT NULL CHECK(jsonb_typeof(projected_public_value)='object'),
 PRIMARY KEY(release_id,type,object_id)
);
CREATE TABLE editorial.legacy_url (
 path text PRIMARY KEY,
 language text,
 target_public_path text,
 source_id text REFERENCES editorial.source(id),
 treatment text NOT NULL CHECK(treatment IN ('bridge','reviewed_copy','missing','restricted')),
 note_private text NOT NULL DEFAULT '',
 CHECK(path NOT LIKE '%..%' AND path NOT LIKE 'http%')
);
-- Import manifests make an exact batch safely replayable; batch IDs are payload hashes.
CREATE TABLE editorial.import_batch (
 batch_id text PRIMARY KEY CHECK(batch_id ~ '^[0-9a-f]{64}$'),
 payload_sha256 text NOT NULL CHECK(payload_sha256 ~ '^[0-9a-f]{64}$'),
 manifest jsonb NOT NULL CHECK(jsonb_typeof(manifest)='object'),
 imported_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE editorial.audit_log (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 at timestamptz NOT NULL DEFAULT now(),
 actor text NOT NULL,
 table_name text NOT NULL,
 operation text NOT NULL,
 record_before jsonb,
 record_after jsonb
);
-- Segurança invoker: função não eleva privilégio e não está exposta.
-- Não é log inviolável contra dono do banco ou serviço privilegiado; exportar
-- periódicos assinados ao acervo independente se se exigir proteção adicional.
CREATE FUNCTION editorial.record_edit() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, editorial AS $$
BEGIN
 INSERT INTO editorial.audit_log(actor,table_name,operation,record_before,record_after)
 VALUES (coalesce(nullif(current_setting('app.editor_actor',true),''),session_user),
         TG_TABLE_NAME,TG_OP,to_jsonb(OLD),to_jsonb(NEW));
 IF TG_OP='DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END $$;
REVOKE ALL ON FUNCTION editorial.record_edit() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION editorial.record_edit() TO zaniratti_editorial_backend;

-- Uma afirmação sem fonte não pode ser confirmada no commit.
CREATE FUNCTION editorial.assertion_requires_citation() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, editorial AS $$
BEGIN
 IF NOT EXISTS (SELECT 1 FROM editorial.citation WHERE assertion_id = NEW.id) THEN
  RAISE EXCEPTION 'assertion % requires at least one citation', NEW.id;
 END IF;
 RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION editorial.assertion_requires_citation() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION editorial.assertion_requires_citation() TO zaniratti_editorial_backend;
CREATE CONSTRAINT TRIGGER assertion_citation_required
AFTER INSERT OR UPDATE ON editorial.assertion
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW
EXECUTE FUNCTION editorial.assertion_requires_citation();

-- Índices nas FKs/joins relevantes. Não é necessário grafo/ltree nesta escala.
CREATE INDEX person_branch_branch_idx ON editorial.person_branch(branch_id);
CREATE INDEX group_participant_person_idx ON editorial.group_participant(person_id);
CREATE INDEX event_person_idx ON editorial.event(person_id);
CREATE INDEX event_group_idx ON editorial.event(group_id);
CREATE INDEX source_object_hash_idx ON editorial.source_object(object_sha256);
CREATE INDEX capture_source_idx ON editorial.capture_occurrence(source_id);
CREATE INDEX capture_object_idx ON editorial.capture_occurrence(object_sha256);
CREATE INDEX capture_url_timestamp_idx ON editorial.capture_occurrence(original_url_private,capture_timestamp);
CREATE INDEX citation_capture_idx ON editorial.citation(capture_id);
CREATE INDEX assertion_person_idx ON editorial.assertion(subject_person_id);
CREATE INDEX assertion_group_idx ON editorial.assertion(subject_group_id);
CREATE INDEX assertion_event_idx ON editorial.assertion(subject_event_id);
CREATE INDEX assertion_target_idx ON editorial.assertion(target_person_id);
CREATE INDEX citation_assertion_idx ON editorial.citation(assertion_id);
CREATE INDEX citation_source_idx ON editorial.citation(source_id);
CREATE INDEX derivative_original_idx ON editorial.derivative(original_sha256);
CREATE INDEX derivative_decision_idx ON editorial.derivative(decision_id);
CREATE INDEX review_target_idx ON editorial.review(target_type,target_id,target_revision);
CREATE INDEX publication_target_idx ON editorial.publication_decision(target_type,target_id,scope);
CREATE INDEX legacy_url_source_idx ON editorial.legacy_url(source_id);

-- Defesa em profundidade: browsers (anon/authenticated) não têm grants/policies,
-- mesmo se configuração futura expuser o schema por engano.
DO $$ DECLARE t record; BEGIN
 FOR t IN SELECT tablename FROM pg_tables WHERE schemaname='editorial' LOOP
  EXECUTE format('ALTER TABLE editorial.%I ENABLE ROW LEVEL SECURITY', t.tablename);
  EXECUTE format('ALTER TABLE editorial.%I FORCE ROW LEVEL SECURITY', t.tablename);
  EXECUTE format('REVOKE ALL ON editorial.%I FROM PUBLIC, anon, authenticated, service_role', t.tablename);
  EXECUTE format('CREATE POLICY backend_read ON editorial.%I FOR SELECT TO zaniratti_editorial_backend USING (true)',t.tablename);
  EXECUTE format('CREATE POLICY backend_insert ON editorial.%I FOR INSERT TO zaniratti_editorial_backend WITH CHECK (true)',t.tablename);
  EXECUTE format('GRANT SELECT,INSERT ON editorial.%I TO zaniratti_editorial_backend', t.tablename);
  IF t.tablename NOT IN ('audit_log','original_object','source_object','capture_occurrence','release_item') THEN
   EXECUTE format('CREATE POLICY backend_update ON editorial.%I FOR UPDATE TO zaniratti_editorial_backend USING (true) WITH CHECK (true)',t.tablename);
   EXECUTE format('GRANT UPDATE ON editorial.%I TO zaniratti_editorial_backend',t.tablename);
   EXECUTE format('CREATE TRIGGER audit_edit AFTER INSERT OR UPDATE ON editorial.%I FOR EACH ROW EXECUTE FUNCTION editorial.record_edit()',t.tablename);
  END IF;
 END LOOP;
END $$;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA editorial FROM PUBLIC, anon, authenticated, service_role;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA editorial TO zaniratti_editorial_backend;
-- Nenhum DELETE concedido. Original/source_object/capture_occurrence/release_item/audit são append-only
-- para backend; owner/superuser continuam privilegiados e precisam disciplina.
-- Não há policy de Storage porque a proposta usa acervo privado fora do site.
-- publication_decision/review/release_item têm alvos polimórficos: exporter/app
-- valida existência, revisão, autorização e fechamento antes de release aprovada.
COMMIT;

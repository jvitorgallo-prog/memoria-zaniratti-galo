# Banco editorial

O banco da família foi modelado no schema privado `editorial`. Ele guarda identidade, agrupamentos parentais, afirmações, fontes, citações, eventos de captura, decisões editoriais e trilha de auditoria. O site público recebe apenas um snapshot aprovado; este schema não é uma fonte de leitura do navegador.

A migration [20261011234306_editorial_private_core.sql](../supabase/migrations/20261011234306_editorial_private_core.sql) foi criada com Supabase CLI 2.120.0, após `supabase init` e `supabase migration new editorial_private_core`. Ela foi aplicada ao projeto hospedado escolhido pela família por `apply_migration` via MCP. O stack local do Supabase não foi aplicado.

## Segurança

`editorial` não aparece em `api.schemas` no [config.toml](../supabase/config.toml). A migration revoga `USAGE` no schema e todos os privilégios de tabela de `PUBLIC`, `anon`, `authenticated` e `service_role`. As 21 tabelas recebem RLS habilitada e forçada. No banco hospedado, verificou-se que `anon`, `authenticated` e `service_role` não têm `USAGE` no schema nem `SELECT` nas tabelas. Só o papel `zaniratti_editorial_backend` recebe políticas, leitura, inserção e atualização limitada; ele é `NOLOGIN`, `NOBYPASSRLS` e não recebe `DELETE`. A credencial real de backend e a associação ao papel continuam fora desta entrega.

Uma trigger diferida impede que uma afirmação chegue ao commit sem citação. Ela permite inserir afirmações e citações na mesma transação. A função de auditoria é `SECURITY INVOKER`; não há função `SECURITY DEFINER`, view pública ou objeto em `public`, `auth`, `storage` ou `realtime`.

## Importação privada

O importador exige explicitamente `--source`. Também exige os catálogos e índices que fornecem os metadados de ocorrências. A saída contém SQL e manifesto com hashes de todas as entradas e do próprio importador. Os arquivos são gravados no diretório passado por `--output-dir`; use um diretório privado fora do checkout. O SQL traz metadados, hashes e localizadores privados, nunca o conteúdo dos PDFs, e-mails ou capturas.

Exemplo para reproduzir a importação usada na validação local:

```sh
python3 scripts/import-editorial.py \
  --source /workspace/zaniratti-rodada06-santa-clara-2026-10-11/resultados_revistos/pessoas_parentescos_consolidado.json \
  --site-catalog /workspace/zaniratti-estrutura-site-2026-10-11/luna_site/catalogo_site.json \
  --document-catalog /workspace/zaniratti-estrutura-site-2026-10-11/luna_documentos/catalogo_documental.json \
  --site-ledger /workspace/zaniratti-estrutura-site-2026-10-11/luna_site/ledger_upload.csv \
  --document-ledger /workspace/zaniratti-estrutura-site-2026-10-11/luna_documentos/ledger_uploads.csv \
  --wayback-index /workspace/zaniratti-consolidado/resultados/snapshots_wayback.csv \
  --commoncrawl-index /workspace/zaniratti-consolidado/resultados/snapshots_commoncrawl.csv \
  --output-dir /workspace/zaniratti-implementacao-2026-10-11/privado
```

Não copie os artefatos `.sql`/`.manifest.json` gerados para Git. O `batch_id` deriva dos hashes da base, dos catálogos, dos ledgers, dos índices e do importador. Reexecutar o mesmo SQL não reinsere linhas, nem repete auditoria. Uma nova revisão do corpus deve receber revisão editorial explícita antes da importação; conflitos de identidade estável não devem ser contornados mudando o hash do lote.

## Modelo e preservação

Os 118 parentescos são afirmações independentes com `predicate='parent_of'` e sua classe de evidência original. Um agrupamento `parental_group` representa apenas os pais e filhos que constam no corpus; não é evidência de casamento. A mãe de Valentim permanece não atribuída. `Reni` e `lourdes_esposito` são IDs diferentes, e a correção de identidade permanece como afirmação citada.

As 326 afirmações do corpus, 118 afirmações de parentesco e 89 rótulos nominais somam 533 registros de `assertion`. Os 89 rótulos adicionais preservam o nome de navegação legado e não são 89 novos fatos genealógicos. As 819 citações podem apontar para fontes repetidas e documentos que reproduzem o mesmo ato; a contagem não indica independência documental.

Capturas têm identidade própria. Os 1.203 registros Wayback do índice foram deduplicados pela chave origem + URL original + timestamp + SHA-256 do payload, resultando em 1.186 eventos únicos; capturas em datas diferentes permanecem separadas mesmo quando o hash coincide. Foram ingeridos também os 251 registros Common Crawl. Vinte e quatro ocorrências adicionais do catálogo do site não estavam nos dois índices detalhados e ficaram como `indexed_only`. Capturas sem bytes privados verificados mantêm o SHA-256 esperado no campo `expected_payload_sha256`, sem referência a um objeto recuperado. A contagem não afirma que o inventário cubra todos os arquivos ou capturas existentes.

Cada entrada do catálogo documental mantém sua ocorrência de custódia. Os localizadores Drive e caminhos de acervo são privados. Os ZIPs e arquivos originais permanecem no acervo; esta importação não os extrai nem os replica.

Datas mantêm seu literal original. O importador estrutura anos, meses e dias somente quando estão explícitos. Não preenche dia ou mês ausente. Classes de evidência, interpretação e divulgação são campos diferentes; todo registro importado permanece `restricted`, independentemente de `adotado='sim'` no corpus.

## Validação executada

Não havia `psql`, PostgreSQL local ou Supabase CLI instalados como comandos do sistema. A CLI foi usada via npm somente para gerar o esqueleto da migration; `npx supabase --version` informou 2.120.0. Para executar o SQL, `@electric-sql/pglite@0.5.8` foi instalado em `/workspace/zaniratti-implementacao-2026-10-11/privado/validador`, sem alterar configurações de pacotes do site.

O verificador [verify-editorial.mjs](../scripts/verify-editorial.mjs) recria um banco PGlite privado, cria os três papéis de API simulados, aplica a migration e o lote, repete a importação e consulta o estado. Ele confirma o bloqueio de leitura direta como `anon`, grants ausentes para os papéis de navegador, RLS forçada, citações, contagens de relações, a separação de Reni/Lourdes, a mãe desconhecida de Valentim, os ramos históricos sem aresta entre eles e datas literais sem componentes fabricados. O relatório numérico está em [BANCO-VALIDACAO.txt](BANCO-VALIDACAO.txt).

O ensaio em PGlite comprova a execução local. No banco hospedado PostgreSQL 17, o lote foi enviado em 53 partes para staging privado, o SHA-256 do SQL bruto foi conferido e uma única transação `DO` executou a promoção; depois, uma migration separada removeu a tabela temporária de transporte. O banco remoto contém 89 pessoas, 20 grupos, 853 registros na tabela `source`, 118 arestas parent_of, 533 afirmações, 819 citações, 418 objetos, 1.890 ocorrências, 2.444 linhas de auditoria e um manifesto; não há afirmações sem citação. A verificação também confirmou RLS forçada e ausência de acesso de leitura dos papéis de API. A organização permanece no plano Free e foi usado um projeto existente, sem upgrade, pausa ou exclusão. O schema e os dados editoriais não são expostos ao navegador.

O site público foi publicado em 2026-10-12: [Memória Zaniratti e Galo](https://jvitorgallo-prog.github.io/memoria-zaniratti-galo/). GET da página inicial e da rota `/pt` retornaram HTTP 200. O QA em produção confirmou 12 rotas desktop e sete mobile com HTTP 200, busca por Reni e Custode, sem erros JavaScript nem overflow horizontal.

import snapshotJson from '../../content/public/snapshot.json';

export type Interpretation = 'preferred' | 'alternative' | 'disputed' | 'annotation';
export type EvidenceClass = string;

export interface PublicDate {
  literal: string;
  qualifier: 'exact' | 'about' | 'before' | 'after' | 'between' | 'unknown';
  precision: 'day' | 'month' | 'year' | 'century' | 'interval' | 'unknown';
  components: { year: number | null; month: number | null; day: number | null };
  lower_bound: { year: number | null; month: number | null; day: number | null } | null;
  upper_bound: { year: number | null; month: number | null; day: number | null } | null;
  normalization_note: string;
}

export interface PublicPerson {
  id: string;
  label: string;
  preferred_name_assertion_id: string;
  claim_ids: string[];
  branch_ids: string[];
  aliases: string[];
}

export interface PublicBranch {
  id: string;
  label: string;
  description: string;
  person_ids: string[];
  note: string;
}

export interface PublicGroup {
  id: string;
  kind: 'parental_group' | 'union';
  participant_ids: string[];
  participants: Array<{ person_id: string; role: 'parent' | 'spouse' | 'child' | 'family_member' }>;
  event_ids: string[];
  note: string;
}

export interface PublicEvent {
  id: string;
  type: 'birth' | 'death' | 'marriage' | 'migration' | 'residence' | 'other';
  subject_kind: 'person' | 'group';
  subject_id: string;
  claim_ids: string[];
}

export interface PublicAssertion {
  id: string;
  subject_kind: 'person' | 'group' | 'event';
  subject_id: string;
  predicate: string;
  object_person_id: string | null;
  literal: string;
  date: PublicDate | null;
  interpretation: Interpretation;
  evidence_class: EvidenceClass;
  citation_ids: string[];
  public_note: string;
}

export interface PublicCitation {
  id: string;
  source_id: string;
  locator: string;
  quote: string | null;
  translation: string | null;
  language: string | null;
}

export interface PublicSource {
  id: string;
  title: string;
  kind: 'provided_document' | 'historic_site' | 'family_testimony' | 'archive_document' | 'secondary_work' | 'other';
  public_reference: string;
  approved_external_url: string | null;
  reproduction: 'metadata_only' | 'reviewed_copy';
  asset_ids: string[];
  public_note: string;
}

export interface PublicAsset {
  id: string;
  public_path: string;
  sha256: string;
  mime: 'image/jpeg' | 'image/png' | 'image/webp' | 'image/avif' | 'image/gif' | 'application/pdf';
  bytes: number;
  alt: string;
  caption: string;
  rights_public_note: string;
}

export interface PublicLegacyUrl {
  old_path: string;
  new_path: string;
  treatment: 'bridge' | 'reviewed_copy' | 'missing';
  note: string;
}

export interface PublicBiographyParagraph {
  text: string;
  source_ids: string[];
  citation_ids: string[];
}

export interface PublicBiography {
  id: string;
  person_id: string;
  title: string;
  paragraphs: PublicBiographyParagraph[];
  source_ids: string[];
}

export interface PublicArchiveItem {
  id: string;
  title: string;
  kind: 'historical_page' | 'photograph' | 'diagram' | 'document' | 'inventory_record';
  status: 'public_derivative' | 'original_public' | 'capture_indexed' | 'catalog_only' | 'local_copy_review_needed';
  legacy_path: string;
  capture_url: string | null;
  capture_timestamp_utc: string | null;
  original_sha256: string | null;
  original_bytes: number | null;
  mime: string;
  public_path: string | null;
  public_sha256: string | null;
  public_bytes: number | null;
  person_ids: string[];
  event_ids: string[];
  source_ids: string[];
  description: string;
  transcript: string | null;
}

export interface PublicRelease {
  id: string;
  state: 'candidate' | 'approved' | 'published';
  generated_at: string;
  content_revision: string;
  locale: 'pt' | 'it';
  public_changelog: string;
}

export interface PublicSnapshot {
  schema_version: '1.1.0';
  release: PublicRelease;
  people: PublicPerson[];
  branches: PublicBranch[];
  groups: PublicGroup[];
  events: PublicEvent[];
  assertions: PublicAssertion[];
  citations: PublicCitation[];
  sources: PublicSource[];
  assets: PublicAsset[];
  legacy_urls: PublicLegacyUrl[];
  biographies: PublicBiography[];
  archive_items: PublicArchiveItem[];
}

export const publicData = snapshotJson as PublicSnapshot;
export const snapshot = publicData;

export function getPublicData(): PublicSnapshot {
  return publicData;
}

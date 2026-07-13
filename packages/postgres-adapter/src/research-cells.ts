import {
  CellPlanRecordSchema as CellPlanSchema,
  CellReceiptRecordSchema as CellReceiptSchema,
  CorrelationAssessmentRecordSchema as CorrelationAssessmentSchema,
  DissentReportRecordSchema as DissentReportSchema,
  ModelProfileRecordSchema as ModelProfileSchema,
  ModelProfileVersionRecordSchema as ModelProfileVersionSchema,
  PersistenceConflictError,
  PersistenceIntegrityError,
  ResearchPositionRecordSchema as ResearchPositionSchema,
  ResearchReviewRecordSchema as ResearchReviewSchema,
  RejectedAuditResidueRecordSchema as RejectedAuditResidueSchema,
  assertPayloadDigest,
  parseResearchCellState,
  type CellPlanRecord as CellPlan,
  type CellPlanStatusUpdate,
  type CellReceiptRecord as CellReceipt,
  type CorrelationAssessmentRecord as CorrelationAssessment,
  type DissentReportRecord as DissentReport,
  type ModelLineageRepository,
  type ModelProfileRecord as ModelProfile,
  type ModelProfileVersionRecord as ModelProfileVersion,
  type ModelProfileWrite,
  type ReconstructedResearchCellState,
  type RejectedAuditResidueRecord as RejectedAuditResidue,
  type ResearchCellRepository,
  type ResearchPositionRecord as ResearchPosition,
  type ResearchReviewRecord as ResearchReview,
} from '@mammoth/persistence';
import type { PostgresConnection, TransactionOptions } from './driver.js';

export interface PostgresResearchCellOptions {
  readonly transaction: TransactionOptions;
  readonly now: () => string;
}

export class PostgresModelLineageRepository implements ModelLineageRepository {
  constructor(
    private readonly database: PostgresConnection,
    private readonly options: PostgresResearchCellOptions,
  ) {}

  async upsertModelProfile(input: ModelProfileWrite): Promise<ModelProfile> {
    if (
      input.id !== input.contract.id ||
      input.provider !== input.contract.provider ||
      input.canonicalName !== input.contract.displayName ||
      input.familyId !== input.contract.family
    )
      throw new PersistenceIntegrityError(
        'model profile write metadata drifts from domain contract',
      );
    const now = this.options.now();
    await this.database.transaction(this.options.transaction, async (tx) => {
      const existing = await tx.query<ModelProfileRow>(
        'select * from mammoth_model_profiles where id = $1 for update',
        [input.id],
      );
      if (existing.rows[0]) {
        if (
          input.expectedRevision !== undefined &&
          Number(existing.rows[0].revision) !== input.expectedRevision
        ) {
          throw new PersistenceConflictError(
            `stale model profile revision for ${input.id}`,
          );
        }
        const updated = await tx.query(
          `update mammoth_model_profiles
             set provider = $2, canonical_name = $3, family_id = $4, active = $5,
                 authoritative_contract = $6::jsonb,
                 revision = revision + 1, updated_at = $7::timestamptz
           where id = $1 and revision = $8`,
          [
            input.id,
            input.provider,
            input.canonicalName,
            input.familyId,
            input.active,
            JSON.stringify(input.contract),
            now,
            existing.rows[0].revision,
          ],
        );
        if (updated.rowCount !== 1) {
          throw new PersistenceConflictError(
            `concurrent model profile update for ${input.id}`,
          );
        }
      } else {
        if (
          input.expectedRevision !== undefined &&
          input.expectedRevision !== 0
        ) {
          throw new PersistenceConflictError(
            `missing model profile ${input.id} for expected revision`,
          );
        }
        await tx.query(
          `insert into mammoth_model_profiles
            (id, provider, canonical_name, family_id, active, authoritative_contract,
             revision, created_at, updated_at)
           values ($1, $2, $3, $4, $5, $6::jsonb, 0, $7::timestamptz, $7::timestamptz)`,
          [
            input.id,
            input.provider,
            input.canonicalName,
            input.familyId,
            input.active,
            JSON.stringify(input.contract),
            now,
          ],
        );
      }

      for (const alias of new Set([input.canonicalName, ...input.aliases])) {
        await tx.query(
          `insert into mammoth_model_profile_aliases
            (profile_id, provider, alias, first_seen_at, last_seen_at)
           values ($1, $2, $3, $4::timestamptz, $4::timestamptz)
           on conflict (profile_id, provider, alias)
           do update set last_seen_at = excluded.last_seen_at`,
          [input.id, input.provider, alias, now],
        );
      }
    });
    const stored = await this.readModelProfile(input.id);
    if (!stored)
      throw new PersistenceConflictError(`model profile ${input.id} vanished`);
    return stored;
  }

  async appendModelProfileVersion(
    input: ModelProfileVersion,
  ): Promise<ModelProfileVersion> {
    const parsed = ModelProfileVersionSchema.parse(input);
    await this.database.query(
      `insert into mammoth_model_profile_versions
        (id, profile_id, profile_revision, provider, model_name, checkpoint, family_id,
         lineage_status, training_lineage_ids, fine_tune_lineage_ids, shared_derivation_ids,
         locality, modalities, context_window, data_policy_id, cost_profile_id, declared_at,
         metadata, authoritative_contract)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10::jsonb,$11::jsonb,$12,$13::jsonb,$14,$15,$16,$17::timestamptz,$18::jsonb,$19::jsonb)`,
      [
        parsed.id,
        parsed.profileId,
        parsed.profileRevision,
        parsed.provider,
        parsed.modelName,
        parsed.checkpoint,
        parsed.familyId,
        parsed.lineageStatus,
        JSON.stringify(parsed.trainingLineageIds),
        JSON.stringify(parsed.fineTuneLineageIds),
        JSON.stringify(parsed.sharedDerivationIds),
        parsed.locality,
        JSON.stringify(parsed.modalities),
        parsed.contextWindow,
        parsed.dataPolicyId,
        parsed.costProfileId,
        parsed.declaredAt,
        JSON.stringify(parsed.metadata),
        JSON.stringify(parsed.contract),
      ],
    );
    return parsed;
  }

  async readModelProfile(id: string): Promise<ModelProfile | undefined> {
    const result = await this.database.query<ModelProfileRow>(
      `select profile.*,
              coalesce(jsonb_agg(alias.alias order by alias.first_seen_at, alias.alias)
                filter (where alias.alias is not null), '[]'::jsonb) as aliases
         from mammoth_model_profiles profile
         left join mammoth_model_profile_aliases alias on alias.profile_id = profile.id
        where profile.id = $1
        group by profile.id`,
      [id],
    );
    return result.rows[0] ? toModelProfile(result.rows[0]) : undefined;
  }

  async readModelProfileVersion(
    id: string,
  ): Promise<ModelProfileVersion | undefined> {
    const result = await this.database.query<ModelProfileVersionRow>(
      'select * from mammoth_model_profile_versions where id = $1',
      [id],
    );
    return result.rows[0] ? toModelProfileVersion(result.rows[0]) : undefined;
  }

  async listModelProfileVersions(
    profileId: string,
  ): Promise<readonly ModelProfileVersion[]> {
    const result = await this.database.query<ModelProfileVersionRow>(
      `select * from mammoth_model_profile_versions
        where profile_id = $1 order by profile_revision`,
      [profileId],
    );
    return result.rows.map(toModelProfileVersion);
  }
}

export class PostgresResearchCellRepository implements ResearchCellRepository {
  constructor(
    private readonly database: PostgresConnection,
    private readonly options: PostgresResearchCellOptions,
  ) {}

  async createCellPlan(input: CellPlan): Promise<CellPlan> {
    const parsed = CellPlanSchema.parse(input);
    await this.database.query(
      `insert into mammoth_cell_plans
        (id, program_id, work_item_id, criterion_id, criterion_digest, plan_version,
         template_version, branch_id, role, input_digest, output_contract_version,
         status, revision, fencing_token, created_at, updated_at, authoritative_contract)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15::timestamptz,$16::timestamptz,$17::jsonb)`,
      [
        parsed.id,
        parsed.programId,
        parsed.workItemId,
        parsed.criterionId,
        parsed.criterionDigest,
        parsed.planVersion,
        parsed.templateVersion,
        parsed.branchId,
        parsed.role,
        parsed.inputDigest,
        parsed.outputContractVersion,
        parsed.status,
        parsed.revision,
        parsed.fencingToken,
        parsed.createdAt,
        parsed.updatedAt,
        JSON.stringify(parsed.contract),
      ],
    );
    return parsed;
  }

  async updateCellPlanStatus(input: CellPlanStatusUpdate): Promise<CellPlan> {
    const now = this.options.now();
    const updated = await this.database.query<CellPlanRow>(
      `update mammoth_cell_plans
          set status = $4, revision = revision + 1, fencing_token = fencing_token + 1,
              terminal_reason = $5, updated_at = $6::timestamptz
        where id = $1 and revision = $2 and fencing_token = $3
        returning *`,
      [
        input.id,
        input.expectedRevision,
        input.expectedFencingToken,
        input.nextStatus,
        input.terminalReason ?? null,
        now,
      ],
    );
    const row = updated.rows[0];
    if (!row)
      throw new PersistenceConflictError(
        `stale cell plan revision or fence for ${input.id}`,
      );
    return toCellPlan(row);
  }

  async recordPosition(input: ResearchPosition): Promise<ResearchPosition> {
    const parsed = ResearchPositionSchema.parse(input);
    await this.database.query(
      `insert into mammoth_research_positions
        (id, cell_plan_id, program_id, work_item_id, criterion_id, criterion_digest,
         model_profile_id, model_profile_version_id, input_digest, output_schema_version,
         position_digest, claim_ids, evidence_ids, hypothesis_ids, proposal_refs,
         usage, uncertainty_code, failure_code, body, recorded_at, authoritative_contract)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,$13::jsonb,$14::jsonb,$15::jsonb,$16::jsonb,$17,$18,$19::jsonb,$20::timestamptz,$21::jsonb)`,
      positionParameters(parsed),
    );
    return parsed;
  }

  async recordReview(input: ResearchReview): Promise<ResearchReview> {
    const parsed = ResearchReviewSchema.parse(input);
    await this.database.query(
      `insert into mammoth_research_reviews
        (id, position_id, cell_plan_id, program_id, work_item_id, criterion_id, criterion_digest,
         model_profile_id, model_profile_version_id, reviewer_role, input_digest,
         output_schema_version, review_digest, verdict, claim_ids, evidence_ids,
         hypothesis_ids, usage, uncertainty_code, failure_code, reasons, body, recorded_at,
         authoritative_contract)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15::jsonb,$16::jsonb,$17::jsonb,$18::jsonb,$19,$20,$21::jsonb,$22::jsonb,$23::timestamptz,$24::jsonb)`,
      [
        parsed.id,
        parsed.positionId,
        parsed.cellPlanId,
        parsed.programId,
        parsed.workItemId,
        parsed.criterionId,
        parsed.criterionDigest,
        parsed.modelProfileId,
        parsed.modelProfileVersionId,
        parsed.reviewerRole,
        parsed.inputDigest,
        parsed.outputSchemaVersion,
        parsed.reviewDigest,
        parsed.verdict,
        JSON.stringify(parsed.claimIds),
        JSON.stringify(parsed.evidenceIds),
        JSON.stringify(parsed.hypothesisIds),
        JSON.stringify(parsed.usage),
        parsed.uncertaintyCode,
        parsed.failureCode,
        JSON.stringify(parsed.reasons),
        JSON.stringify(parsed.body),
        parsed.recordedAt,
        JSON.stringify(parsed.contract),
      ],
    );
    return parsed;
  }

  async recordDissent(input: DissentReport): Promise<DissentReport> {
    const parsed = DissentReportSchema.parse(input);
    await this.database.query(
      `insert into mammoth_dissent_reports
        (id, cell_plan_id, program_id, criterion_id, criterion_digest,
         author_model_profile_version_id, report_digest, claim_ids, evidence_ids,
         minority_position_ids, body, recorded_at, authoritative_contract)
       values ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb,$10::jsonb,$11::jsonb,$12::timestamptz,$13::jsonb)`,
      [
        parsed.id,
        parsed.cellPlanId,
        parsed.programId,
        parsed.criterionId,
        parsed.criterionDigest,
        parsed.authorModelProfileVersionId,
        parsed.reportDigest,
        JSON.stringify(parsed.claimIds),
        JSON.stringify(parsed.evidenceIds),
        JSON.stringify(parsed.minorityPositionIds),
        JSON.stringify(parsed.body),
        parsed.recordedAt,
        JSON.stringify(parsed.contract),
      ],
    );
    return parsed;
  }

  async recordCorrelation(
    input: CorrelationAssessment,
  ): Promise<CorrelationAssessment> {
    const parsed = CorrelationAssessmentSchema.parse(input);
    await this.database.query(
      `insert into mammoth_correlation_assessments
        (id, left_model_profile_version_id, right_model_profile_version_id,
         policy_version, correlation_score, independence_verdict, reasons,
         assessment_digest, assessed_at, authoritative_contract)
       values ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9::timestamptz,$10::jsonb)`,
      [
        parsed.id,
        parsed.leftModelProfileVersionId,
        parsed.rightModelProfileVersionId,
        parsed.policyVersion,
        parsed.correlationScore,
        parsed.independenceVerdict,
        JSON.stringify(parsed.reasons),
        parsed.assessmentDigest,
        parsed.assessedAt,
        JSON.stringify(parsed.contract),
      ],
    );
    return parsed;
  }

  async recordRejectedResidue(
    input: RejectedAuditResidue,
  ): Promise<RejectedAuditResidue> {
    const parsed = RejectedAuditResidueSchema.parse(input);
    assertPayloadDigest(
      parsed.payload,
      parsed.payloadDigest,
      'rejected residue',
    );
    await this.database.query(
      `insert into mammoth_rejected_audit_residue
        (id, program_id, subject_type, subject_id, reason_code, policy_version,
         payload_digest, payload, recorded_at)
       values ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::timestamptz)`,
      [
        parsed.id,
        parsed.programId,
        parsed.subjectType,
        parsed.subjectId,
        parsed.reasonCode,
        parsed.policyVersion,
        parsed.payloadDigest,
        JSON.stringify(parsed.payload),
        parsed.recordedAt,
      ],
    );
    return parsed;
  }

  async recordReceipt(input: CellReceipt): Promise<CellReceipt> {
    const parsed = CellReceiptSchema.parse(input);
    assertPayloadDigest(parsed.payload, parsed.receiptDigest, 'cell receipt');
    await this.database.query(
      `insert into mammoth_cell_receipts
        (id, program_id, subject_type, subject_id, work_item_id, receipt_kind,
         receipt_digest, payload, created_at)
       values ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::timestamptz)`,
      [
        parsed.id,
        parsed.programId,
        parsed.subjectType,
        parsed.subjectId,
        parsed.workItemId,
        parsed.receiptKind,
        parsed.receiptDigest,
        JSON.stringify(parsed.payload),
        parsed.createdAt,
      ],
    );
    return parsed;
  }

  async reconstructProgram(
    programId: string,
  ): Promise<ReconstructedResearchCellState> {
    const [
      profiles,
      versions,
      plans,
      positions,
      reviews,
      dissentReports,
      correlations,
      rejected,
      receipts,
    ] = await Promise.all([
      this.database.query<ModelProfileRow>(
        `select profile.*,
                coalesce(jsonb_agg(alias.alias order by alias.first_seen_at, alias.alias)
                  filter (where alias.alias is not null), '[]'::jsonb) as aliases
           from mammoth_model_profiles profile
           join mammoth_model_profile_versions version on version.profile_id = profile.id
           left join mammoth_model_profile_aliases alias on alias.profile_id = profile.id
          where version.id in (
            select model_profile_version_id from mammoth_research_positions where program_id = $1
            union
            select model_profile_version_id from mammoth_research_reviews where program_id = $1
            union
            select author_model_profile_version_id from mammoth_dissent_reports where program_id = $1
          )
          group by profile.id
          order by profile.id`,
        [programId],
      ),
      this.database.query<ModelProfileVersionRow>(
        `select version.* from mammoth_model_profile_versions version
          where version.id in (
            select model_profile_version_id from mammoth_research_positions where program_id = $1
            union
            select model_profile_version_id from mammoth_research_reviews where program_id = $1
            union
            select author_model_profile_version_id from mammoth_dissent_reports where program_id = $1
          )
          order by version.profile_id, version.profile_revision`,
        [programId],
      ),
      this.database.query<CellPlanRow>(
        'select * from mammoth_cell_plans where program_id = $1 order by created_at, id',
        [programId],
      ),
      this.database.query<PositionRow>(
        'select * from mammoth_research_positions where program_id = $1 order by recorded_at, id',
        [programId],
      ),
      this.database.query<ReviewRow>(
        'select * from mammoth_research_reviews where program_id = $1 order by recorded_at, id',
        [programId],
      ),
      this.database.query<DissentRow>(
        'select * from mammoth_dissent_reports where program_id = $1 order by recorded_at, id',
        [programId],
      ),
      this.database.query<CorrelationRow>(
        `select distinct corr.* from mammoth_correlation_assessments corr
          join mammoth_model_profile_versions left_version on left_version.id = corr.left_model_profile_version_id
          join mammoth_model_profile_versions right_version on right_version.id = corr.right_model_profile_version_id
         where corr.left_model_profile_version_id in (
           select model_profile_version_id from mammoth_research_positions where program_id = $1
           union select model_profile_version_id from mammoth_research_reviews where program_id = $1
         )
            or corr.right_model_profile_version_id in (
           select model_profile_version_id from mammoth_research_positions where program_id = $1
           union select model_profile_version_id from mammoth_research_reviews where program_id = $1
         )
         order by corr.assessed_at, corr.id`,
        [programId],
      ),
      this.database.query<RejectedRow>(
        'select * from mammoth_rejected_audit_residue where program_id = $1 order by recorded_at, id',
        [programId],
      ),
      this.database.query<ReceiptRow>(
        'select * from mammoth_cell_receipts where program_id = $1 order by created_at, id',
        [programId],
      ),
    ]);

    return parseResearchCellState({
      programId,
      modelProfiles: profiles.rows.map(toModelProfile),
      modelProfileVersions: versions.rows.map(toModelProfileVersion),
      cellPlans: plans.rows.map(toCellPlan),
      positions: positions.rows.map(toPosition),
      reviews: reviews.rows.map(toReview),
      dissentReports: dissentReports.rows.map(toDissent),
      correlationAssessments: correlations.rows.map(toCorrelation),
      rejectedResidue: rejected.rows.map(toRejected),
      receipts: receipts.rows.map(toReceipt),
    });
  }
}

interface ModelProfileRow extends Record<string, unknown> {
  id: string;
  provider: string;
  canonical_name: string;
  family_id: string;
  active: boolean;
  aliases: unknown;
  revision: number;
  created_at: string;
  updated_at: string;
  authoritative_contract: unknown;
}
interface ModelProfileVersionRow extends Record<string, unknown> {
  id: string;
  profile_id: string;
  profile_revision: number;
  provider: string;
  model_name: string;
  checkpoint: string;
  family_id: string;
  lineage_status: ModelProfileVersion['lineageStatus'];
  training_lineage_ids: unknown;
  fine_tune_lineage_ids: unknown;
  shared_derivation_ids: unknown;
  locality: ModelProfileVersion['locality'];
  modalities: unknown;
  context_window: number;
  data_policy_id: string;
  cost_profile_id: string;
  declared_at: string;
  metadata: unknown;
  authoritative_contract: unknown;
}
interface CellPlanRow extends Record<string, unknown> {
  id: string;
  program_id: string;
  work_item_id: string;
  criterion_id: string;
  criterion_digest: CellPlan['criterionDigest'];
  plan_version: string;
  template_version: string;
  branch_id: string;
  role: string;
  input_digest: CellPlan['inputDigest'];
  output_contract_version: string;
  status: CellPlan['status'];
  revision: number;
  fencing_token: number;
  created_at: string;
  updated_at: string;
  authoritative_contract: unknown;
}
interface PositionRow extends Record<string, unknown> {
  id: string;
  cell_plan_id: string;
  program_id: string;
  work_item_id: string;
  criterion_id: string;
  criterion_digest: ResearchPosition['criterionDigest'];
  model_profile_id: string;
  model_profile_version_id: string;
  input_digest: ResearchPosition['inputDigest'];
  output_schema_version: string;
  position_digest: ResearchPosition['positionDigest'];
  claim_ids: unknown;
  evidence_ids: unknown;
  hypothesis_ids: unknown;
  proposal_refs: unknown;
  usage: unknown;
  uncertainty_code: string | null;
  failure_code: string | null;
  body: unknown;
  recorded_at: string;
  authoritative_contract: unknown;
}
interface ReviewRow
  extends Omit<PositionRow, 'position_digest' | 'proposal_refs'> {
  position_id: string;
  reviewer_role: string;
  review_digest: ResearchReview['reviewDigest'];
  verdict: ResearchReview['verdict'];
  reasons: unknown;
}
interface DissentRow extends Record<string, unknown> {
  id: string;
  cell_plan_id: string;
  program_id: string;
  criterion_id: string;
  criterion_digest: DissentReport['criterionDigest'];
  author_model_profile_version_id: string;
  report_digest: DissentReport['reportDigest'];
  claim_ids: unknown;
  evidence_ids: unknown;
  minority_position_ids: unknown;
  body: unknown;
  recorded_at: string;
  authoritative_contract: unknown;
}
interface CorrelationRow extends Record<string, unknown> {
  id: string;
  left_model_profile_version_id: string;
  right_model_profile_version_id: string;
  policy_version: string;
  correlation_score: number;
  independence_verdict: CorrelationAssessment['independenceVerdict'];
  reasons: unknown;
  assessment_digest: CorrelationAssessment['assessmentDigest'];
  assessed_at: string;
  authoritative_contract: unknown;
}
interface RejectedRow extends Record<string, unknown> {
  id: string;
  program_id: string;
  subject_type: RejectedAuditResidue['subjectType'];
  subject_id: string;
  reason_code: string;
  policy_version: string;
  payload_digest: RejectedAuditResidue['payloadDigest'];
  payload: unknown;
  recorded_at: string;
}
interface ReceiptRow extends Record<string, unknown> {
  id: string;
  program_id: string;
  subject_type: string;
  subject_id: string;
  work_item_id: string;
  receipt_kind: string;
  receipt_digest: CellReceipt['receiptDigest'];
  payload: unknown;
  created_at: string;
}

function toModelProfile(row: ModelProfileRow): ModelProfile {
  return ModelProfileSchema.parse({
    contract: row.authoritative_contract,
    id: row.id,
    provider: row.provider,
    canonicalName: row.canonical_name,
    familyId: row.family_id,
    active: row.active,
    aliases: asArray(row.aliases),
    revision: Number(row.revision),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
}
function toModelProfileVersion(
  row: ModelProfileVersionRow,
): ModelProfileVersion {
  return ModelProfileVersionSchema.parse({
    contract: row.authoritative_contract,
    id: row.id,
    profileId: row.profile_id,
    profileRevision: Number(row.profile_revision),
    provider: row.provider,
    modelName: row.model_name,
    checkpoint: row.checkpoint,
    familyId: row.family_id,
    lineageStatus: row.lineage_status,
    trainingLineageIds: asArray(row.training_lineage_ids),
    fineTuneLineageIds: asArray(row.fine_tune_lineage_ids),
    sharedDerivationIds: asArray(row.shared_derivation_ids),
    locality: row.locality,
    modalities: asArray(row.modalities),
    contextWindow: Number(row.context_window),
    dataPolicyId: row.data_policy_id,
    costProfileId: row.cost_profile_id,
    declaredAt: row.declared_at,
    metadata: row.metadata,
  });
}
function toCellPlan(row: CellPlanRow): CellPlan {
  return CellPlanSchema.parse({
    contract: row.authoritative_contract,
    id: row.id,
    programId: row.program_id,
    workItemId: row.work_item_id,
    criterionId: row.criterion_id,
    criterionDigest: row.criterion_digest,
    planVersion: row.plan_version,
    templateVersion: row.template_version,
    branchId: row.branch_id,
    role: row.role,
    inputDigest: row.input_digest,
    outputContractVersion: row.output_contract_version,
    status: row.status,
    revision: Number(row.revision),
    fencingToken: Number(row.fencing_token),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
}
function toPosition(row: PositionRow): ResearchPosition {
  return ResearchPositionSchema.parse({
    contract: row.authoritative_contract,
    id: row.id,
    cellPlanId: row.cell_plan_id,
    programId: row.program_id,
    workItemId: row.work_item_id,
    criterionId: row.criterion_id,
    criterionDigest: row.criterion_digest,
    modelProfileId: row.model_profile_id,
    modelProfileVersionId: row.model_profile_version_id,
    inputDigest: row.input_digest,
    outputSchemaVersion: row.output_schema_version,
    positionDigest: row.position_digest,
    claimIds: asArray(row.claim_ids),
    evidenceIds: asArray(row.evidence_ids),
    hypothesisIds: asArray(row.hypothesis_ids),
    proposalRefs: asArray(row.proposal_refs),
    usage: row.usage,
    uncertaintyCode: row.uncertainty_code,
    failureCode: row.failure_code,
    body: row.body,
    recordedAt: row.recorded_at,
  });
}
function toReview(row: ReviewRow): ResearchReview {
  return ResearchReviewSchema.parse({
    contract: row.authoritative_contract,
    id: row.id,
    positionId: row.position_id,
    cellPlanId: row.cell_plan_id,
    programId: row.program_id,
    workItemId: row.work_item_id,
    criterionId: row.criterion_id,
    criterionDigest: row.criterion_digest,
    modelProfileId: row.model_profile_id,
    modelProfileVersionId: row.model_profile_version_id,
    reviewerRole: row.reviewer_role,
    inputDigest: row.input_digest,
    outputSchemaVersion: row.output_schema_version,
    reviewDigest: row.review_digest,
    verdict: row.verdict,
    claimIds: asArray(row.claim_ids),
    evidenceIds: asArray(row.evidence_ids),
    hypothesisIds: asArray(row.hypothesis_ids),
    usage: row.usage,
    uncertaintyCode: row.uncertainty_code,
    failureCode: row.failure_code,
    reasons: asArray(row.reasons),
    body: row.body,
    recordedAt: row.recorded_at,
  });
}
function toDissent(row: DissentRow): DissentReport {
  return DissentReportSchema.parse({
    contract: row.authoritative_contract,
    id: row.id,
    cellPlanId: row.cell_plan_id,
    programId: row.program_id,
    criterionId: row.criterion_id,
    criterionDigest: row.criterion_digest,
    authorModelProfileVersionId: row.author_model_profile_version_id,
    reportDigest: row.report_digest,
    claimIds: asArray(row.claim_ids),
    evidenceIds: asArray(row.evidence_ids),
    minorityPositionIds: asArray(row.minority_position_ids),
    body: row.body,
    recordedAt: row.recorded_at,
  });
}
function toCorrelation(row: CorrelationRow): CorrelationAssessment {
  return CorrelationAssessmentSchema.parse({
    contract: row.authoritative_contract,
    id: row.id,
    leftModelProfileVersionId: row.left_model_profile_version_id,
    rightModelProfileVersionId: row.right_model_profile_version_id,
    policyVersion: row.policy_version,
    correlationScore: Number(row.correlation_score),
    independenceVerdict: row.independence_verdict,
    reasons: asArray(row.reasons),
    assessmentDigest: row.assessment_digest,
    assessedAt: row.assessed_at,
  });
}
function toRejected(row: RejectedRow): RejectedAuditResidue {
  return RejectedAuditResidueSchema.parse({
    id: row.id,
    programId: row.program_id,
    subjectType: row.subject_type,
    subjectId: row.subject_id,
    reasonCode: row.reason_code,
    policyVersion: row.policy_version,
    payloadDigest: row.payload_digest,
    payload: row.payload,
    recordedAt: row.recorded_at,
  });
}
function toReceipt(row: ReceiptRow): CellReceipt {
  return CellReceiptSchema.parse({
    id: row.id,
    programId: row.program_id,
    subjectType: row.subject_type,
    subjectId: row.subject_id,
    workItemId: row.work_item_id,
    receiptKind: row.receipt_kind,
    receiptDigest: row.receipt_digest,
    payload: row.payload,
    createdAt: row.created_at,
  });
}
function positionParameters(parsed: ResearchPosition): readonly unknown[] {
  return [
    parsed.id,
    parsed.cellPlanId,
    parsed.programId,
    parsed.workItemId,
    parsed.criterionId,
    parsed.criterionDigest,
    parsed.modelProfileId,
    parsed.modelProfileVersionId,
    parsed.inputDigest,
    parsed.outputSchemaVersion,
    parsed.positionDigest,
    JSON.stringify(parsed.claimIds),
    JSON.stringify(parsed.evidenceIds),
    JSON.stringify(parsed.hypothesisIds),
    JSON.stringify(parsed.proposalRefs),
    JSON.stringify(parsed.usage),
    parsed.uncertaintyCode,
    parsed.failureCode,
    JSON.stringify(parsed.body),
    parsed.recordedAt,
    JSON.stringify(parsed.contract),
  ];
}
function asArray(value: unknown): readonly string[] {
  if (!Array.isArray(value)) return [];
  return value.map(String);
}

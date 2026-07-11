# Mammoth Observatory

> Status: design contract
>
> Scope: read-only visualization beyond the operator CLI
>
> Authority: none; the observatory never mutates epistemic state

## Product role

The CLI remains the precise operator and automation surface. The Observatory is
the inspect-and-understand surface: a high-density spatial view of how claims,
evidence, research cells, dissent, cost, and time relate.

The intended experience is a living epistemic instrument, not a decorative 3D
network. Every visual mark must answer an operator question or disappear.

## Primary questions

1. What does Mammoth currently believe, and under which named policy?
2. Which immutable evidence supports or contradicts each claim?
3. Where are uncertainty, criterion drift, correlation, and preserved dissent?
4. Which cells and workers are active, blocked, failed, or over budget?
5. How did the program change over time, and can every transition be inspected?
6. Which factual sentences made the dossier, and why were others excluded?

## Information architecture

### Command deck

A restrained 2D frame around the spatial view:

- Program identity, criterion, lifecycle state, freshness, and publication state.
- Search and deterministic filters.
- Layer controls for claims, evidence, cells, lineage, cost, and audit history.
- A time scrubber for replaying durable state transitions.
- Selection inspector with exact IDs, policy verdicts, locators, digests, and
  receipts.

### Epistemic field

The central 3D scene:

- **Claims** are the primary navigable nodes.
- **Evidence snapshots** are fixed anchors; their position should feel stable.
- **Support and contradiction** are visibly different directed edges.
- **Research-cell positions** orbit claims as proposals until admitted.
- **Unresolved and contradicted work** remains present, never faded into absence.
- **Correlated model lineages** cluster visually so nominal model count cannot
  imply independence.
- **Dissent** remains spatially distinct after synthesis.

### Dossier trace

A readable 2D document view synchronized with the field. Selecting a factual
sentence focuses its claim, assessment, evidence locator, and snapshot. Selecting
an excluded claim shows the named reason it did not render.

### Operations timeline

A durable event rail for workflow steps, leases, retries, revalidation, budgets,
cancellation, human gates, receipts, and integrity failures.

## Read-only projection contract

The UI consumes versioned projections, not database tables and not Temporal
history directly.

```typescript
export interface ObservatoryProjectionV1 {
  schemaVersion: 1;
  generatedAt: string;
  sourceRevision: string;
  program: ProgramProjection;
  nodes: ObservatoryNode[];
  edges: ObservatoryEdge[];
  timeline: TimelineEventProjection[];
  dossier: DossierProjection;
  integrity: ProjectionIntegrity;
}

export type ObservatoryNode =
  | ClaimNode
  | EvidenceNode
  | ResearchCellNode
  | PositionNode
  | ModelLineageNode
  | WorkItemNode;

export interface ObservatoryEdge {
  id: string;
  from: string;
  to: string;
  kind:
    | 'supports'
    | 'contradicts'
    | 'depends_on'
    | 'proposed_by'
    | 'reviewed_by'
    | 'derived_from'
    | 'shares_lineage'
    | 'rendered_as';
  status: 'active' | 'expired' | 'rejected' | 'unresolved';
  receiptId?: string;
}

export interface ProjectionIntegrity {
  digest: string;
  authoritativeRevision: number;
  auditHeadHash: string;
  complete: boolean;
  omissions: string[];
}
```

The production read model should be built from Postgres projections and immutable
artifact metadata. It may link to Temporal execution identifiers, but it must not
treat Temporal as the product query store.

## Visual grammar

- Support uses cool luminous structure; contradiction uses warm tension.
- Unresolved state is explicit amber, not low-opacity gray.
- Integrity failure interrupts the scene with a hard fail-closed treatment.
- Node size represents a selected measurable quantity only; it never defaults to
  model confidence.
- Edge thickness never represents model vote count.
- Motion communicates state transition, lineage flow, or time. Ambient motion is
  subtle and can be disabled.
- Labels prioritize exact IDs and short canonical text. Full prose belongs in the
  inspector.

## Interaction rules

- The same selection must be addressable by URL and keyboard without the 3D scene.
- Every spatial view has a deterministic 2D table/graph equivalent.
- Camera movement never hides the active selection or breaks browser navigation.
- Large graphs use semantic aggregation with honest counts and visible filters;
  they do not silently drop nodes.
- Reduced-motion, high-contrast, screen-reader, and keyboard modes are first-class.
- A screenshot or exported view includes the projection digest and filter state.

## Performance envelope

- First meaningful 2D projection before the 3D bundle is interactive.
- Progressive scene loading from stable projection pages.
- Instanced rendering for repeated marks and worker-side layout calculation.
- Level-of-detail based on semantic importance and camera distance.
- A bounded default scene; operators explicitly expand large neighborhoods.

## Delivery sequence

1. Freeze the projection schema alongside P1 adapter contracts.
2. Implement a deterministic projection builder after Postgres/CAS read models
   exist.
3. Ship a high-fidelity 2D Observatory shell with trace and timeline views.
4. Prototype the spatial field against checked-in fixtures.
5. Add research-cell and model-lineage layers after P4 contracts land.
6. Promote 3D to the default view only if usability tests show it improves
   comprehension over the 2D equivalent.

## Non-goals for the current push

- Selecting React, Three.js, React Three Fiber, Babylon, or a desktop shell.
- Treating the browser as an authoritative state store.
- Starting or cancelling workflows from an unversioned visualization endpoint.
- Encoding confidence as spectacle.
- Rendering unconstrained model transcripts as a graph.

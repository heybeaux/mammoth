# Production CAS adapter

This package implements retrieval's frozen `ContentAddressedStore` behind two
injected ports: a byte backend with staging and atomic create-if-absent publish,
and a transactional artifact-metadata port. It imports no concrete adapter.

Writes verify staged bytes before publication, verify the canonical destination
before metadata publication, then create-or-verify metadata in one transaction.
Failed metadata commits deliberately leave inspectable orphans. Reads verify the
digest and recorded size every time. Reconciliation reports or quarantines only
unreferenced byte objects and never invents metadata or deletes referenced bytes.

# Route Modules

- `ops-routes.ts`: health and worker-health endpoints.
- `connectors-routes.ts`: Box and PracticePanther connection/auth/sync flows.
- `case-catalog-routes.ts`: case list/detail/update, document types, and dev case scaffold creation.
- `case-data-routes.ts`: review queue, normalization, OCR/extraction review, projections, file content, and other case document pipeline endpoints.
- `document-template-routes.ts`: case-scoped document template CRUD, render, and fill persistence.
- `package-workbench-routes.ts`: AI assembly, package rules, package runs, approvals, and DOCX export.
- `exhibit-routes.ts`: exhibit packets, sections, exhibits, items, packet preview, packet PDF export, suggestions, and exhibit list generation.
- `case-guards.ts`: shared case ownership and route guard helpers.
- `types.ts`: shared reply/helper route types used across modules.

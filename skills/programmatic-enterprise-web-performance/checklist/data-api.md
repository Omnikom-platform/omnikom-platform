# data-api (shipgate spec 8.0.0)

P0 = blocks release, P1 = must fix, P2 = should fix, W = warning. [kinds]: static = read from code/config; http, browser = needs the running site.

- API-001 P0 [contract, http, build] Every endpoint the service exposes is declared in a contract; every declared endpoint exists
- API-002 P0 [contract, http] Responses to declared example requests and to contract-derived generated requests match the contract (status, headers, body schema), including error responses
- API-003 P0 [http] Status semantics, judged over every response to API-002 example and generated requests and to SEC-030 fuzz requests
- API-004 P0 [contract] No breaking changes against the latest contract in released/ unless the contract's major version is bumped and the change is declared
- API-005 P1 [contract, http] Pagination. List endpoints = contract GET operations whose 200 response schema is an array or has a top-level array property. Each declares a query parameter named limit, per_page, perPage, pageSize, page_size, first or
- API-006 P1 [http] Idempotency. For each idempotentPosts entry, the first examples request (03 § 14) whose request.method is POST and whose request.path equals the entry after 04 § 10 normalisation of the path (query stripped, a trailing
- API-007 P1 [http] Body size limit: for each contract operation with a request body, one request whose body is valid JSON padded with one extra string field to 2 × maxBodyBytes answers 413 (mutating stage, 04 § 4.2 step 8); any other stat
- API-008 P1 [contract, cmd, ast] Client types are generated from the contract
- API-009 P1 [http] Race safety: for each raceSensitive entry, its example request (03 § 14) is sent 10 times concurrently with identical inputs and session (mutating stage, 04 § 4.2 step 8): 10 separate connections are opened and each req
- DB-001 P0 [db] Migrations are the only path to schema changes
- DB-002 P0† [diff, lock] Applied migrations are immutable
- DB-003 P1 [db] Safe-migration rules, on migration files added in the diff
- DB-004 P0† [db] Row Level Security: every table in exposedSchemas has RLS enabled and at least one policy; a policy for INSERT, UPDATE, DELETE or ALL whose qual or with_check is the constant true, and whose roles include PUBLIC or any
- DB-006 P0 [db, lock] Destructive statements in migrations (DROP TABLE, DROP COLUMN, TRUNCATE, DELETE/UPDATE without WHERE) require an entry in db.approvedDestructive with the file's SHA-256 (signed policy), never a marker inside the file
- DB-007 P1 [db] Part fk-index: every foreign key created by a migration file added in the diff (statements attributed per DB-006), judged after migration on the database catalog in G4 right after 04 § 4.2 step 4, has an index on its ta
- DB-008 P1 [ast] No N+1 patterns, in changed code (04 § 13 DB-008)
- DB-009 P0 [db, cfg] Postgres API exposure (after migrations, from the catalog)
- DB-010 W [browser, db] Query plans on large tables: queries logged during G6 on the embedded instance (04 § 4.2: PostgreSQL log_min_duration_statement = 0; MySQL general log) that read a largeTables table holding ≥ planRows rows after seeding
- DB-011 P0† [cfg, db] Firebase security rules (Firestore, Storage, Realtime Database; files from firebase.json)
- DB-012 P0 [db, ast] No seeded credentials in production migrations
- JOB-001 P1 [cfg, ast] Every scheduled or queued job is declared in jobs
- JOB-002 P1 [db] (Runtime part of db, evaluated in G4, 04 § 1.1.) Jobs are idempotent
- JOB-003 P1 [ast] Bounded retries. Failure swallowing in job handlers is owned by AGT-010. Every queue/job registration matched by adapter jobDiscovery sets the adapter-declared retry argument (adapter jobRetryArgs entry arg, 03 § 6; e.g

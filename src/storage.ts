import { Database } from "bun:sqlite";
import { createHash } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { config } from "./config";

let db: Database | undefined;

export function ensureStorage(): Database {
  mkdirSync(config.dataRoot, { recursive: true });
  mkdirSync(config.reposRoot, { recursive: true });
  mkdirSync(config.workcellsRoot, { recursive: true });
  if (config.artifactImportRoot) mkdirSync(config.artifactImportRoot, { recursive: true });
  mkdirSync(dirname(config.dbPath), { recursive: true });

  if (!db) {
    db = new Database(config.dbPath);
    db.run("PRAGMA journal_mode = WAL");
    db.run("PRAGMA foreign_keys = ON");
    db.run(`
      CREATE TABLE IF NOT EXISTS repositories (
        id TEXT PRIMARY KEY,
        owner TEXT NOT NULL,
        name TEXT NOT NULL,
        default_branch TEXT NOT NULL,
        storage_path TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(owner, name)
      )
    `);
    db.run(`
      CREATE TABLE IF NOT EXISTS ref_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        type TEXT NOT NULL,
        repo_id TEXT NOT NULL,
        owner TEXT NOT NULL,
        repo TEXT NOT NULL,
        ref TEXT NOT NULL,
        old_sha TEXT NOT NULL,
        new_sha TEXT NOT NULL,
        actor TEXT NOT NULL,
        created_at TEXT NOT NULL,
        FOREIGN KEY(repo_id) REFERENCES repositories(id)
      )
    `);
    db.run(`
      CREATE TABLE IF NOT EXISTS git_tokens (
        id TEXT PRIMARY KEY,
        repo_id TEXT,
        token_hash TEXT NOT NULL UNIQUE,
        token_hint TEXT NOT NULL,
        actor TEXT NOT NULL,
        scopes_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        revoked_at TEXT,
        expires_at TEXT,
        FOREIGN KEY(repo_id) REFERENCES repositories(id)
      )
    `);
    addColumnIfMissing(db, "git_tokens", "expires_at", "TEXT");
    db.run(`
      CREATE TABLE IF NOT EXISTS repository_refs (
        repo_id TEXT NOT NULL,
        ref TEXT NOT NULL,
        sha TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY(repo_id, ref),
        FOREIGN KEY(repo_id) REFERENCES repositories(id)
      )
    `);
    db.run(`
      CREATE TABLE IF NOT EXISTS workcells (
        id TEXT PRIMARY KEY,
        repo_id TEXT NOT NULL,
        token_id TEXT NOT NULL,
        checkout_path TEXT NOT NULL,
        actor TEXT,
        created_at TEXT NOT NULL,
        revoked_at TEXT,
        FOREIGN KEY(repo_id) REFERENCES repositories(id),
        FOREIGN KEY(token_id) REFERENCES git_tokens(id)
      )
    `);
    addColumnIfMissing(db, "workcells", "actor", "TEXT");
    db.run(`
      CREATE TABLE IF NOT EXISTS checkpoints (
        id TEXT PRIMARY KEY,
        repo_id TEXT NOT NULL,
        commit_sha TEXT NOT NULL,
        previous_sha TEXT,
        label TEXT NOT NULL,
        checkpoint_type TEXT NOT NULL,
        actor TEXT NOT NULL,
        created_at TEXT NOT NULL,
        FOREIGN KEY(repo_id) REFERENCES repositories(id)
      )
    `);
    db.run(`
      CREATE TABLE IF NOT EXISTS deployments (
        id TEXT PRIMARY KEY,
        repo_id TEXT NOT NULL,
        commit_sha TEXT NOT NULL,
        checkpoint_id TEXT,
        environment TEXT NOT NULL,
        status TEXT NOT NULL,
        deploy_type TEXT NOT NULL,
        previous_commit_sha TEXT,
        created_at TEXT NOT NULL,
        FOREIGN KEY(repo_id) REFERENCES repositories(id),
        FOREIGN KEY(checkpoint_id) REFERENCES checkpoints(id)
      )
    `);
    db.run(`
      CREATE TABLE IF NOT EXISTS verification_results (
        id TEXT PRIMARY KEY,
        deployment_id TEXT NOT NULL,
        repo_id TEXT NOT NULL,
        commit_sha TEXT NOT NULL,
        status TEXT NOT NULL,
        summary TEXT,
        created_at TEXT NOT NULL,
        FOREIGN KEY(deployment_id) REFERENCES deployments(id),
        FOREIGN KEY(repo_id) REFERENCES repositories(id)
      )
    `);
    db.run(`
      CREATE TABLE IF NOT EXISTS grid_publish_requests (
        id TEXT PRIMARY KEY,
        app_id TEXT NOT NULL,
        repo_id TEXT NOT NULL,
        account_ref TEXT NOT NULL,
        workspace_ref TEXT NOT NULL,
        deployment_id TEXT NOT NULL,
        checkpoint_id TEXT,
        commit_sha TEXT NOT NULL,
        environment TEXT NOT NULL,
        status TEXT NOT NULL,
        grid_operation_ref TEXT NOT NULL,
        preview_url TEXT,
        verification_status TEXT,
        repair_action TEXT,
        owner_plane TEXT NOT NULL,
        grid_receipt_id TEXT,
        callback_status TEXT,
        callback_received_at TEXT,
        grid_callback_json TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY(deployment_id) REFERENCES deployments(id)
      )
    `);
    addColumnIfMissing(db, "grid_publish_requests", "grid_receipt_id", "TEXT");
    addColumnIfMissing(db, "grid_publish_requests", "callback_status", "TEXT");
    addColumnIfMissing(db, "grid_publish_requests", "callback_received_at", "TEXT");
    addColumnIfMissing(db, "grid_publish_requests", "grid_callback_json", "TEXT");
    db.run(`
      CREATE TABLE IF NOT EXISTS receipts (
        id TEXT PRIMARY KEY,
        repo_id TEXT NOT NULL,
        deployment_id TEXT,
        receipt_type TEXT NOT NULL,
        body_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        FOREIGN KEY(repo_id) REFERENCES repositories(id),
        FOREIGN KEY(deployment_id) REFERENCES deployments(id)
      )
    `);
    db.run(`
      CREATE TABLE IF NOT EXISTS mirror_targets (
        id TEXT PRIMARY KEY,
        repo_id TEXT NOT NULL,
        provider TEXT NOT NULL,
        remote_url TEXT NOT NULL,
        credential_ref TEXT,
        enabled INTEGER NOT NULL,
        status TEXT NOT NULL,
        last_mirrored_sha TEXT,
        last_success_at TEXT,
        last_failure_at TEXT,
        last_error TEXT,
        last_checked_at TEXT,
        diverged_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY(repo_id) REFERENCES repositories(id)
      )
    `);
    db.run(`
      CREATE TABLE IF NOT EXISTS mirror_refs (
        mirror_target_id TEXT NOT NULL,
        ref TEXT NOT NULL,
        sha TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY(mirror_target_id, ref),
        FOREIGN KEY(mirror_target_id) REFERENCES mirror_targets(id)
      )
    `);
    db.run(`
      CREATE TABLE IF NOT EXISTS mirror_runs (
        id TEXT PRIMARY KEY,
        repo_id TEXT NOT NULL,
        mirror_target_id TEXT NOT NULL,
        status TEXT NOT NULL,
        trigger TEXT NOT NULL,
        ref_count INTEGER NOT NULL,
        last_mirrored_sha TEXT,
        error TEXT,
        created_at TEXT NOT NULL,
        FOREIGN KEY(repo_id) REFERENCES repositories(id),
        FOREIGN KEY(mirror_target_id) REFERENCES mirror_targets(id)
      )
    `);
    db.run(`
      CREATE TABLE IF NOT EXISTS issues (
        id TEXT PRIMARY KEY,
        repo_id TEXT NOT NULL,
        number INTEGER NOT NULL,
        title TEXT NOT NULL,
        body TEXT,
        status TEXT NOT NULL,
        external_provider TEXT,
        external_id TEXT,
        created_by TEXT NOT NULL,
        closed_by TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        closed_at TEXT,
        UNIQUE(repo_id, number),
        UNIQUE(repo_id, external_provider, external_id),
        FOREIGN KEY(repo_id) REFERENCES repositories(id)
      )
    `);
    db.run(`
      CREATE TABLE IF NOT EXISTS issue_comments (
        id TEXT PRIMARY KEY,
        repo_id TEXT NOT NULL,
        issue_id TEXT NOT NULL,
        actor TEXT NOT NULL,
        body TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY(repo_id) REFERENCES repositories(id),
        FOREIGN KEY(issue_id) REFERENCES issues(id)
      )
    `);
    db.run(`
      CREATE TABLE IF NOT EXISTS issue_links (
        id TEXT PRIMARY KEY,
        repo_id TEXT NOT NULL,
        issue_id TEXT NOT NULL,
        link_type TEXT NOT NULL,
        target_id TEXT,
        target_ref TEXT,
        target_sha TEXT,
        metadata_json TEXT NOT NULL,
        actor TEXT NOT NULL,
        created_at TEXT NOT NULL,
        FOREIGN KEY(repo_id) REFERENCES repositories(id),
        FOREIGN KEY(issue_id) REFERENCES issues(id)
      )
    `);
    db.run(`
      CREATE TABLE IF NOT EXISTS pull_requests (
        id TEXT PRIMARY KEY,
        repo_id TEXT NOT NULL,
        number INTEGER NOT NULL,
        title TEXT NOT NULL,
        body TEXT,
        status TEXT NOT NULL,
        base_ref TEXT NOT NULL,
        head_ref TEXT NOT NULL,
        base_sha TEXT NOT NULL,
        head_sha TEXT NOT NULL,
        issue_id TEXT,
        require_verification INTEGER NOT NULL,
        verification_status TEXT,
        verification_summary TEXT,
        preview_url TEXT,
        deployment_id TEXT,
        receipt_id TEXT,
        merge_method TEXT,
        merge_commit_sha TEXT,
        merged_by TEXT,
        merged_at TEXT,
        closed_by TEXT,
        closed_at TEXT,
        created_by TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(repo_id, number),
        FOREIGN KEY(repo_id) REFERENCES repositories(id),
        FOREIGN KEY(issue_id) REFERENCES issues(id)
      )
    `);
    db.run(`
      CREATE TABLE IF NOT EXISTS pull_request_merges (
        id TEXT PRIMARY KEY,
        repo_id TEXT NOT NULL,
        pull_request_id TEXT NOT NULL,
        old_base_sha TEXT NOT NULL,
        head_sha TEXT NOT NULL,
        new_base_sha TEXT NOT NULL,
        merge_method TEXT NOT NULL,
        actor TEXT NOT NULL,
        created_at TEXT NOT NULL,
        FOREIGN KEY(repo_id) REFERENCES repositories(id),
        FOREIGN KEY(pull_request_id) REFERENCES pull_requests(id)
      )
    `);
    db.run(`
      CREATE TABLE IF NOT EXISTS external_sources (
        id TEXT PRIMARY KEY,
        repo_id TEXT NOT NULL,
        provider TEXT NOT NULL,
        remote_url TEXT NOT NULL,
        default_branch TEXT NOT NULL,
        credential_ref TEXT,
        status TEXT NOT NULL,
        last_seen_default_sha TEXT,
        last_checked_at TEXT,
        last_error TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY(repo_id) REFERENCES repositories(id)
      )
    `);
    db.run(`
      CREATE TABLE IF NOT EXISTS external_source_events (
        id TEXT PRIMARY KEY,
        repo_id TEXT NOT NULL,
        external_source_id TEXT NOT NULL,
        event_type TEXT NOT NULL,
        ref TEXT,
        old_sha TEXT,
        new_sha TEXT,
        actor TEXT NOT NULL,
        created_at TEXT NOT NULL,
        FOREIGN KEY(repo_id) REFERENCES repositories(id),
        FOREIGN KEY(external_source_id) REFERENCES external_sources(id)
      )
    `);
    db.run(`
      CREATE TABLE IF NOT EXISTS external_workcells (
        id TEXT PRIMARY KEY,
        repo_id TEXT NOT NULL,
        external_source_id TEXT NOT NULL,
        checkout_path TEXT NOT NULL,
        created_at TEXT NOT NULL,
        FOREIGN KEY(repo_id) REFERENCES repositories(id),
        FOREIGN KEY(external_source_id) REFERENCES external_sources(id)
      )
    `);
    db.run(`
      CREATE TABLE IF NOT EXISTS external_pull_requests (
        id TEXT PRIMARY KEY,
        repo_id TEXT NOT NULL,
        external_source_id TEXT NOT NULL,
        external_number INTEGER NOT NULL,
        title TEXT NOT NULL,
        body TEXT,
        status TEXT NOT NULL,
        base_ref TEXT NOT NULL,
        head_ref TEXT NOT NULL,
        head_sha TEXT NOT NULL,
        issue_external_id TEXT,
        provider_url TEXT,
        receipt_id TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(external_source_id, external_number),
        FOREIGN KEY(repo_id) REFERENCES repositories(id),
        FOREIGN KEY(external_source_id) REFERENCES external_sources(id)
      )
    `);
    db.run(`
      CREATE TABLE IF NOT EXISTS repo_imports (
        id TEXT PRIMARY KEY,
        repo_id TEXT NOT NULL,
        provider TEXT NOT NULL,
        source_url TEXT NOT NULL,
        default_branch TEXT NOT NULL,
        status TEXT NOT NULL,
        branch_count INTEGER NOT NULL,
        tag_count INTEGER NOT NULL,
        head_sha TEXT,
        actor TEXT NOT NULL,
        error TEXT,
        created_at TEXT NOT NULL,
        FOREIGN KEY(repo_id) REFERENCES repositories(id)
      )
    `);
    db.run(`
      CREATE TABLE IF NOT EXISTS repo_exports (
        id TEXT PRIMARY KEY,
        repo_id TEXT NOT NULL,
        provider TEXT NOT NULL,
        destination_url TEXT NOT NULL,
        status TEXT NOT NULL,
        branch_count INTEGER NOT NULL,
        tag_count INTEGER NOT NULL,
        head_sha TEXT,
        actor TEXT NOT NULL,
        error TEXT,
        created_at TEXT NOT NULL,
        FOREIGN KEY(repo_id) REFERENCES repositories(id)
      )
    `);
    db.run(`
      CREATE TABLE IF NOT EXISTS repo_remotes (
        id TEXT PRIMARY KEY,
        repo_id TEXT NOT NULL,
        name TEXT NOT NULL,
        provider TEXT NOT NULL,
        remote_url TEXT NOT NULL,
        role TEXT NOT NULL,
        created_by TEXT NOT NULL,
        created_at TEXT NOT NULL,
        removed_at TEXT,
        UNIQUE(repo_id, name),
        FOREIGN KEY(repo_id) REFERENCES repositories(id)
      )
    `);
    db.run(`
      CREATE TABLE IF NOT EXISTS repo_collaborators (
        id TEXT PRIMARY KEY,
        repo_id TEXT NOT NULL,
        username TEXT NOT NULL,
        role TEXT NOT NULL,
        token_id TEXT NOT NULL,
        created_at TEXT NOT NULL,
        revoked_at TEXT,
        UNIQUE(repo_id, username),
        FOREIGN KEY(repo_id) REFERENCES repositories(id),
        FOREIGN KEY(token_id) REFERENCES git_tokens(id)
      )
    `);
    db.run(`
      CREATE TABLE IF NOT EXISTS backups (
        id TEXT PRIMARY KEY,
        status TEXT NOT NULL,
        backup_path TEXT NOT NULL,
        metadata_path TEXT NOT NULL,
        repo_count INTEGER NOT NULL,
        error TEXT,
        created_at TEXT NOT NULL
      )
    `);
    db.run(`
      CREATE TABLE IF NOT EXISTS restore_rehearsals (
        id TEXT PRIMARY KEY,
        backup_id TEXT NOT NULL,
        status TEXT NOT NULL,
        restore_path TEXT NOT NULL,
        fsck_repo_count INTEGER NOT NULL,
        metadata_repo_count INTEGER NOT NULL,
        metadata_ref_count INTEGER NOT NULL,
        metadata_event_count INTEGER NOT NULL,
        error TEXT,
        created_at TEXT NOT NULL,
        FOREIGN KEY(backup_id) REFERENCES backups(id)
      )
    `);
    db.run(`
      CREATE TABLE IF NOT EXISTS audit_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        event_type TEXT NOT NULL,
        method TEXT NOT NULL,
        path TEXT NOT NULL,
        status INTEGER NOT NULL,
        actor_hint TEXT,
        content_length INTEGER,
        created_at TEXT NOT NULL
      )
    `);
    db.run(`
      CREATE TABLE IF NOT EXISTS workflow_projections (
        id TEXT PRIMARY KEY,
        repo_id TEXT NOT NULL,
        provider TEXT NOT NULL,
        remote_url TEXT,
        canonical_mode TEXT NOT NULL,
        status TEXT NOT NULL,
        created_by TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY(repo_id) REFERENCES repositories(id)
      )
    `);
    db.run(`
      CREATE TABLE IF NOT EXISTS workflow_projected_issues (
        id TEXT PRIMARY KEY,
        repo_id TEXT NOT NULL,
        projection_id TEXT NOT NULL,
        issue_id TEXT NOT NULL,
        external_number INTEGER NOT NULL,
        external_title TEXT NOT NULL,
        external_body TEXT NOT NULL,
        status TEXT NOT NULL,
        divergence_status TEXT NOT NULL,
        last_projected_at TEXT NOT NULL,
        last_checked_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(projection_id, issue_id),
        UNIQUE(projection_id, external_number),
        FOREIGN KEY(repo_id) REFERENCES repositories(id),
        FOREIGN KEY(projection_id) REFERENCES workflow_projections(id),
        FOREIGN KEY(issue_id) REFERENCES issues(id)
      )
    `);
    db.run(`
      CREATE TABLE IF NOT EXISTS workflow_projected_pull_requests (
        id TEXT PRIMARY KEY,
        repo_id TEXT NOT NULL,
        projection_id TEXT NOT NULL,
        pull_request_id TEXT NOT NULL,
        external_number INTEGER NOT NULL,
        external_title TEXT NOT NULL,
        external_body TEXT NOT NULL,
        status TEXT NOT NULL,
        divergence_status TEXT NOT NULL,
        last_projected_at TEXT NOT NULL,
        last_checked_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(projection_id, pull_request_id),
        UNIQUE(projection_id, external_number),
        FOREIGN KEY(repo_id) REFERENCES repositories(id),
        FOREIGN KEY(projection_id) REFERENCES workflow_projections(id),
        FOREIGN KEY(pull_request_id) REFERENCES pull_requests(id)
      )
    `);
    db.run(`
      CREATE TABLE IF NOT EXISTS workflow_projection_comments (
        id TEXT PRIMARY KEY,
        repo_id TEXT NOT NULL,
        projection_id TEXT NOT NULL,
        subject_type TEXT NOT NULL,
        subject_id TEXT NOT NULL,
        external_number INTEGER NOT NULL,
        transition TEXT NOT NULL,
        body TEXT NOT NULL,
        created_at TEXT NOT NULL,
        UNIQUE(projection_id, subject_type, subject_id, transition),
        FOREIGN KEY(repo_id) REFERENCES repositories(id),
        FOREIGN KEY(projection_id) REFERENCES workflow_projections(id)
      )
    `);
    db.run(`
      CREATE TABLE IF NOT EXISTS performance_runs (
        id TEXT PRIMARY KEY,
        status TEXT NOT NULL,
        summary_json TEXT NOT NULL,
        created_at TEXT NOT NULL
      )
    `);
    db.run(`
      CREATE TABLE IF NOT EXISTS app_secret_refs (
        id TEXT PRIMARY KEY,
        repo_id TEXT NOT NULL,
        name TEXT NOT NULL,
        credential_ref TEXT NOT NULL,
        environment TEXT NOT NULL,
        created_by TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        revoked_at TEXT,
        UNIQUE(repo_id, name, environment),
        FOREIGN KEY(repo_id) REFERENCES repositories(id)
      )
    `);
    db.run(`
      CREATE TABLE IF NOT EXISTS secret_grant_requests (
        id TEXT PRIMARY KEY,
        secret_ref_id TEXT NOT NULL,
        first_run_id TEXT NOT NULL,
        launch_id TEXT NOT NULL,
        session_id TEXT NOT NULL,
        app_id TEXT NOT NULL,
        repo_id TEXT NOT NULL,
        account_ref TEXT NOT NULL,
        workspace_ref TEXT NOT NULL,
        name TEXT NOT NULL,
        environment TEXT NOT NULL,
        purpose TEXT NOT NULL,
        grant_status TEXT NOT NULL,
        materialization_status TEXT NOT NULL,
        manifest_path TEXT NOT NULL,
        commit_sha TEXT,
        receipt_id TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        revoked_at TEXT,
        FOREIGN KEY(secret_ref_id) REFERENCES app_secret_refs(id),
        FOREIGN KEY(first_run_id) REFERENCES charter_first_runs(id)
      )
    `);
    db.run(`
      CREATE TABLE IF NOT EXISTS secret_materialization_requests (
        id TEXT PRIMARY KEY,
        secret_grant_request_id TEXT NOT NULL,
        secret_ref_id TEXT NOT NULL,
        app_id TEXT NOT NULL,
        repo_id TEXT NOT NULL,
        account_ref TEXT NOT NULL,
        workspace_ref TEXT NOT NULL,
        session_id TEXT,
        deployment_id TEXT,
        target_plane TEXT NOT NULL,
        target_ref TEXT NOT NULL,
        name TEXT NOT NULL,
        environment TEXT NOT NULL,
        owner_plane TEXT NOT NULL,
        request_status TEXT NOT NULL,
        materialization_status TEXT NOT NULL,
        repair_action TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        revoked_at TEXT,
        FOREIGN KEY(secret_grant_request_id) REFERENCES secret_grant_requests(id),
        FOREIGN KEY(secret_ref_id) REFERENCES app_secret_refs(id)
      )
    `);
    db.run(`
      CREATE TABLE IF NOT EXISTS account_apps (
        id TEXT PRIMARY KEY,
        repo_id TEXT NOT NULL UNIQUE,
        account_ref TEXT NOT NULL,
        workspace_ref TEXT NOT NULL,
        app_slug TEXT NOT NULL,
        display_name TEXT,
        status TEXT NOT NULL,
        source_posture TEXT NOT NULL,
        plan_key TEXT NOT NULL,
        plan_source TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(account_ref, app_slug),
        FOREIGN KEY(repo_id) REFERENCES repositories(id)
      )
    `);
    db.run(`
      CREATE TABLE IF NOT EXISTS account_assertion_uses (
        issuer TEXT NOT NULL,
        assertion_id TEXT NOT NULL,
        audience TEXT NOT NULL,
        subject TEXT NOT NULL,
        account_ref TEXT NOT NULL,
        workspace_ref TEXT NOT NULL,
        key_ref TEXT,
        authority_kind TEXT NOT NULL,
        first_seen_at TEXT NOT NULL,
        last_seen_at TEXT NOT NULL,
        use_count INTEGER NOT NULL,
        expires_at TEXT,
        PRIMARY KEY(issuer, assertion_id)
      )
    `);
    db.run(`
      CREATE TABLE IF NOT EXISTS account_assertion_revocations (
        id TEXT PRIMARY KEY,
        issuer TEXT NOT NULL,
        assertion_id TEXT,
        subject TEXT,
        account_ref TEXT,
        reason TEXT NOT NULL,
        source TEXT NOT NULL,
        revoked_at TEXT NOT NULL
      )
    `);
    db.run(`
      CREATE TABLE IF NOT EXISTS app_setup_states (
        id TEXT PRIMARY KEY,
        app_id TEXT NOT NULL,
        repo_id TEXT NOT NULL,
        status TEXT NOT NULL,
        current_step TEXT NOT NULL,
        steps_json TEXT NOT NULL,
        error TEXT,
        receipt_id TEXT,
        checkpoint_id TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(app_id),
        FOREIGN KEY(app_id) REFERENCES account_apps(id),
        FOREIGN KEY(repo_id) REFERENCES repositories(id),
        FOREIGN KEY(receipt_id) REFERENCES receipts(id),
        FOREIGN KEY(checkpoint_id) REFERENCES checkpoints(id)
      )
    `);
    db.run(`
      CREATE TABLE IF NOT EXISTS app_setup_events (
        id TEXT PRIMARY KEY,
        app_id TEXT NOT NULL,
        repo_id TEXT NOT NULL,
        status TEXT NOT NULL,
        step TEXT NOT NULL,
        message TEXT NOT NULL,
        created_at TEXT NOT NULL,
        FOREIGN KEY(app_id) REFERENCES account_apps(id),
        FOREIGN KEY(repo_id) REFERENCES repositories(id)
      )
    `);
    db.run(`
      CREATE TABLE IF NOT EXISTS artifact_import_intakes (
        id TEXT PRIMARY KEY,
        account_ref TEXT NOT NULL,
        workspace_ref TEXT NOT NULL,
        source_kind TEXT NOT NULL,
        source_label TEXT NOT NULL,
        source_path TEXT NOT NULL,
        status TEXT NOT NULL,
        detected_shape TEXT NOT NULL,
        summary_json TEXT NOT NULL,
        plan_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )
    `);
    db.run(`
      CREATE TABLE IF NOT EXISTS hosted_workcell_sessions (
        id TEXT PRIMARY KEY,
        app_id TEXT NOT NULL,
        repo_id TEXT NOT NULL,
        account_ref TEXT NOT NULL,
        workspace_ref TEXT NOT NULL,
        workcell_id TEXT NOT NULL,
        token_id TEXT NOT NULL,
        source_root TEXT NOT NULL,
        terminal_url TEXT NOT NULL,
        terminal_provider TEXT NOT NULL DEFAULT 'local_placeholder',
        terminal_status TEXT NOT NULL DEFAULT 'ready',
        terminal_message TEXT,
        terminal_fulfillment_id TEXT,
        terminal_route TEXT,
        terminal_lifecycle TEXT,
        terminal_fulfillment_json TEXT,
        production_ssh_json TEXT,
        status TEXT NOT NULL,
        agent_readiness_json TEXT NOT NULL,
        readiness_message TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        revoked_at TEXT,
        UNIQUE(workcell_id),
        FOREIGN KEY(app_id) REFERENCES account_apps(id),
        FOREIGN KEY(repo_id) REFERENCES repositories(id),
        FOREIGN KEY(workcell_id) REFERENCES workcells(id),
        FOREIGN KEY(token_id) REFERENCES git_tokens(id)
      )
    `);
    addColumnIfMissing(db, "hosted_workcell_sessions", "terminal_provider", "TEXT NOT NULL DEFAULT 'local_placeholder'");
    addColumnIfMissing(db, "hosted_workcell_sessions", "terminal_status", "TEXT NOT NULL DEFAULT 'ready'");
    addColumnIfMissing(db, "hosted_workcell_sessions", "terminal_message", "TEXT");
    addColumnIfMissing(db, "hosted_workcell_sessions", "terminal_fulfillment_id", "TEXT");
    addColumnIfMissing(db, "hosted_workcell_sessions", "terminal_route", "TEXT");
    addColumnIfMissing(db, "hosted_workcell_sessions", "terminal_lifecycle", "TEXT");
    addColumnIfMissing(db, "hosted_workcell_sessions", "terminal_fulfillment_json", "TEXT");
    addColumnIfMissing(db, "hosted_workcell_sessions", "production_ssh_json", "TEXT");
    db.run(`
      CREATE TABLE IF NOT EXISTS agent_readiness_checks (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        app_id TEXT NOT NULL,
        repo_id TEXT NOT NULL,
        check_name TEXT NOT NULL,
        status TEXT NOT NULL,
        required INTEGER NOT NULL,
        message TEXT NOT NULL,
        created_at TEXT NOT NULL,
        FOREIGN KEY(session_id) REFERENCES hosted_workcell_sessions(id)
      )
    `);
    db.run(`
      CREATE TABLE IF NOT EXISTS hosted_agent_launches (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        app_id TEXT NOT NULL,
        repo_id TEXT NOT NULL,
        account_ref TEXT NOT NULL,
        workspace_ref TEXT NOT NULL,
        provider TEXT NOT NULL,
        status TEXT NOT NULL,
        source_root TEXT NOT NULL,
        origin_remote TEXT NOT NULL,
        instructions_path TEXT NOT NULL,
        charter_path TEXT NOT NULL,
        first_task TEXT NOT NULL,
        run_scope_ref TEXT NOT NULL,
        git_token_ref TEXT NOT NULL,
        provider_auth_status TEXT NOT NULL,
        provider_auth_ref TEXT,
        provider_cli_json TEXT,
        provider_auth_json TEXT,
        readiness_evidence_json TEXT,
        launch_contract_json TEXT,
        readiness_state TEXT NOT NULL,
        failure_reason TEXT,
        repair_action TEXT,
        launch_message TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY(session_id) REFERENCES hosted_workcell_sessions(id)
      )
    `);
    addColumnIfMissing(db, "hosted_agent_launches", "provider_cli_json", "TEXT");
    addColumnIfMissing(db, "hosted_agent_launches", "provider_auth_json", "TEXT");
    addColumnIfMissing(db, "hosted_agent_launches", "readiness_evidence_json", "TEXT");
    addColumnIfMissing(db, "hosted_agent_launches", "launch_contract_json", "TEXT");
    db.run(`
      CREATE TABLE IF NOT EXISTS charter_first_runs (
        id TEXT PRIMARY KEY,
        launch_id TEXT NOT NULL,
        session_id TEXT NOT NULL,
        app_id TEXT NOT NULL,
        repo_id TEXT NOT NULL,
        account_ref TEXT NOT NULL,
        workspace_ref TEXT NOT NULL,
        status TEXT NOT NULL,
        charter_status TEXT NOT NULL,
        source_kind TEXT NOT NULL,
        artifact_import_id TEXT,
        artifact_import_inspected INTEGER NOT NULL,
        substantial_implementation_allowed INTEGER NOT NULL,
        charter_summary_json TEXT NOT NULL,
        import_context_json TEXT NOT NULL,
        first_run_prompt TEXT NOT NULL,
        readiness_output TEXT NOT NULL,
        repair_action TEXT,
        sufficiency_recorded_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY(launch_id) REFERENCES hosted_agent_launches(id)
      )
    `);
    seedBootstrapToken(db);
  }

  return db;
}

function seedBootstrapToken(database: Database): void {
  const tokenHash = createHash("sha256").update(config.devToken).digest("hex");
  const existing = database.query("SELECT id FROM git_tokens WHERE token_hash = ?").get(tokenHash);
  if (existing) return;

  database.query(`
    INSERT INTO git_tokens
      (id, repo_id, token_hash, token_hint, actor, scopes_json, created_at, revoked_at)
    VALUES
      ($id, NULL, $token_hash, $token_hint, $actor, $scopes_json, $created_at, NULL)
  `).run({
    $id: "token_bootstrap_dev",
    $token_hash: tokenHash,
    $token_hint: "dev-token",
    $actor: "dev-token",
    $scopes_json: JSON.stringify(["repo:create", "repo:admin"]),
    $created_at: new Date().toISOString()
  });
}

function addColumnIfMissing(database: Database, table: string, column: string, type: string): void {
  const columns = database.query<{ name: string }, []>(`PRAGMA table_info(${table})`).all();
  if (columns.some((entry) => entry.name === column)) return;
  database.run(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
}

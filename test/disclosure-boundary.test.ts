import { describe, expect, test } from "bun:test";
import {
  hostedAgentLaunchSupportJson,
  type HostedAgentLaunch
} from "../src/agent-launches";
import { setupStateSupportJson, type AppSetupState } from "../src/app-bundles";
import { receiptSupportJson } from "../src/deployments";
import {
  gridTerminalFulfillmentSupportJson,
  type GridTerminalFulfillment
} from "../src/grid-terminal";
import { gridPublishSupportJson, type GridPublishRequest } from "../src/grid-publish";
import { mirrorSupportJson, type MirrorTarget } from "../src/mirrors";
import {
  normalizeProductionSsh,
  productionSshSessionJson,
  productionSshSupportJson
} from "../src/production-ssh";
import { supportImportSourceUrl } from "../src/support-projection";

const privatePath = "/srv/bittergrid/workcells/customer-app";
const gridApi = "http://grid-control.internal:3000";
const boxRef = "production-host-17";
const credentialRef = "bitterpass://accounts/customer/provider-token";
const downstreamError = "fatal: failed from /srv/private/topology on grid-control.internal";

describe("support disclosure boundary", () => {
  test("hides production SSH targets without changing the orchestration projection", () => {
    const policy = normalizeProductionSsh({
      mode: "operate",
      write_enabled: true,
      write_reason: "approved maintenance",
      target: { service: "web", host_ref: boxRef }
    });

    const session = productionSshSessionJson(policy, "ready");
    const support = productionSshSupportJson(policy, "ready");

    expect(session).toMatchObject({ target: { service: "web", host_ref: boxRef } });
    expect(support).toMatchObject({
      target: { service: null, host_ref: null },
      target_configured: true,
      target_ref_returned: false,
      projection: "support_safe_v1"
    });
    expect(JSON.stringify(support)).not.toContain(boxRef);
  });

  test("projects Grid fulfillment posture without topology or raw errors", () => {
    const fulfillment: GridTerminalFulfillment = {
      id: "grid_terminal_test",
      provider: "bittergrid_api",
      mode: "docker_local",
      owner_plane: "BitterGrid",
      box_ref: boxRef,
      dedicated_box_requested: false,
      dedicated_box_available: true,
      fallback_reason: downstreamError,
      repair_action: downstreamError,
      route: `${privatePath}/terminal`,
      url: `${gridApi}${privatePath}/terminal?credential=${credentialRef}`,
      status: "blocked",
      lifecycle: "grid_workcell_blocked",
      message: downstreamError,
      readiness_state: "blocked",
      source_root: privatePath,
      app_id: "app_public",
      repo_id: "repo_public",
      account_ref: "account_public",
      origin_remote: `https://alice:plain-password@grid-control.internal${privatePath}.git`,
      credential_delivery: "run_scoped_git_credential_helper",
      token_in_url: false,
      clone_url_has_token: false,
      cleanup_status: "active",
      grid_api_url: gridApi,
      grid_workcell_id: "grid-workcell-private",
      grid_workcell_key: "grid-key-private",
      grid_execution_session_id: "grid-session-private",
      grid_operation_ref: "grid-operation-private",
      parent_context: {
        status: "installed",
        files: ["AGENTS.md", "CLAUDE.md", "GEMINI.md"],
        canonical_instructions: "AGENTS.md"
      },
      created_at: "2026-08-21T00:00:00.000Z",
      updated_at: "2026-08-21T00:00:00.000Z"
    };

    const support = gridTerminalFulfillmentSupportJson(fulfillment);
    const text = JSON.stringify(support);
    for (const forbidden of [
      privatePath,
      gridApi,
      boxRef,
      credentialRef,
      "plain-password",
      downstreamError,
      "grid-workcell-private",
      "grid-session-private"
    ]) {
      expect(text).not.toContain(forbidden);
    }
    expect(support).toMatchObject({
      source_root: null,
      source_root_returned: false,
      box_ref: null,
      box_ref_returned: false,
      grid_api_url: null,
      route: null,
      route_configured: true,
      route_returned: false,
      url: null,
      url_configured: true,
      url_returned: false,
      origin_remote: null,
      origin_remote_configured: true,
      origin_remote_returned: false,
      grid_workcell_id: null,
      grid_execution_session_id: null,
      grid_workcell_linked: true,
      grid_execution_session_linked: true,
      grid_refs_returned: false,
      projection: "support_safe_v1"
    });
  });

  test("hides mirror vault references, local paths, and stored Git errors", () => {
    const target: MirrorTarget = {
      id: "mirror_test",
      repo_id: "repo_public",
      provider: "local_git",
      remote_url: privatePath,
      credential_ref: credentialRef,
      enabled: 1,
      status: "failed",
      last_mirrored_sha: null,
      last_success_at: null,
      last_failure_at: "2026-08-21T00:00:00.000Z",
      last_error: downstreamError,
      last_checked_at: "2026-08-21T00:00:00.000Z",
      diverged_at: null,
      created_at: "2026-08-21T00:00:00.000Z",
      updated_at: "2026-08-21T00:00:00.000Z"
    };

    const support = mirrorSupportJson(target);
    const text = JSON.stringify(support);
    for (const forbidden of [privatePath, credentialRef, downstreamError]) expect(text).not.toContain(forbidden);
    expect(support).toMatchObject({
      remote_url: null,
      remote_url_returned: false,
      credential_ref: null,
      credential_ref_present: true,
      credential_ref_returned: false,
      last_error_details_returned: false,
      projection: "support_safe_v1"
    });
  });

  test("hides hosted-launch paths, credential refs, and runtime topology", () => {
    const launch: HostedAgentLaunch = {
      id: "agent_launch_test",
      session_id: "hws_public",
      app_id: "app_public",
      repo_id: "repo_public",
      account_ref: "account_public",
      workspace_ref: "workspace_public",
      provider: "codex",
      status: "blocked",
      source_root: privatePath,
      origin_remote: "https://git.example.test/example/app.git",
      instructions_path: `${privatePath}/AGENTS.md`,
      charter_path: `${privatePath}/APP.md`,
      first_task: "Establish the app charter before implementation.",
      run_scope_ref: "agent_launch:private-run",
      git_token_ref: "token-row-private",
      provider_auth_status: "blocked",
      provider_auth_ref: credentialRef,
      provider_cli_json: JSON.stringify({
        provider: "codex",
        command: "codex",
        available: false,
        status: "missing",
        source: "bittergrid_executor_command_v",
        version: downstreamError,
        path_returned: false,
        repair_action: downstreamError,
        checked_by: "bittergrid_exec",
        exit_code: 1
      }),
      provider_auth_json: JSON.stringify({
        provider: "codex",
        source: "bitterpass_provider_bootstrap_plan",
        status: "blocked",
        mount_status: "blocked",
        reference_present: true,
        reference_returned: false,
        credential_material_returned: false,
        auth_files_returned: false,
        includes_secret_value: false,
        repair_action: downstreamError,
        checked_by: "bittergrid_terminal_provider_bootstrap_dry_run",
        bundle_present: true,
        bootstrap_status: "blocked",
        secret_material_returned: false
      }),
      readiness_evidence_json: JSON.stringify({
        evidence_source: "bittergrid_exec",
        session_ready: true,
        source_root_exists: true,
        instructions_present: true,
        charter_present: true,
        origin_remote_is_bittergit: true,
        origin_remote_has_token: false,
        provider_cli_available: false,
        provider_auth_ready: false,
        git_credential_delivery: "run_scoped_credential_helper",
        terminal_url_has_token: false,
        source_files_visible: ["AGENTS.md", "APP.md", privatePath],
        grid_workcell_id: "grid-workcell-private",
        grid_execution_session_id: "grid-session-private"
      }),
      launch_contract_json: JSON.stringify({
        provider: "codex",
        source_root: privatePath,
        instructions_path: `${privatePath}/AGENTS.md`,
        charter_path: `${privatePath}/APP.md`,
        first_prompt: "Establish the app charter before implementation.",
        implementation_before_charter: "blocked",
        expected_workflow: ["read AGENTS.md", "read APP.md"],
        runtime_refs: {
          bittergit_session_id: "hws_public",
          bittergit_workcell_id: "workcell-private",
          bittergit_run_scope_ref: "run-private",
          factory_run_ref: "factory-private",
          grid_workcell_id: "grid-workcell-private",
          grid_execution_session_id: "grid-session-private",
          bitter_session_ref: "bitter-session-private",
          bitter_log_ref: "bitter-log-private"
        }
      }),
      readiness_state: "blocked",
      failure_reason: "provider_auth_not_mounted",
      repair_action: downstreamError,
      launch_message: downstreamError,
      created_at: "2026-08-21T00:00:00.000Z",
      updated_at: "2026-08-21T00:00:00.000Z"
    };

    const support = hostedAgentLaunchSupportJson(launch);
    const text = JSON.stringify(support);
    for (const forbidden of [
      privatePath,
      credentialRef,
      downstreamError,
      "token-row-private",
      "workcell-private",
      "factory-private",
      "grid-session-private",
      "bitter-log-private"
    ]) expect(text).not.toContain(forbidden);
    expect(support).toMatchObject({
      source_root: null,
      git_token_ref: null,
      source_paths_returned: false,
      git_token_ref_returned: false,
      failure_reason: "provider_auth_not_mounted",
      projection: "support_safe_v1"
    });
  });

  test("sanitizes setup failures and import source locations", () => {
    const state: AppSetupState = {
      id: "setup_public",
      app_id: "app_gate54_projection_unit",
      repo_id: "repo_public",
      status: "repair_required",
      current_step: privatePath,
      steps_json: JSON.stringify([{ name: privatePath, status: downstreamError }]),
      error: downstreamError,
      receipt_id: "rec_public",
      checkpoint_id: "checkpoint_public",
      created_at: "2026-08-21T00:00:00.000Z",
      updated_at: "2026-08-21T00:00:00.000Z"
    };

    const setup = setupStateSupportJson(state);
    expect(JSON.stringify(setup)).not.toContain(downstreamError);
    expect(JSON.stringify(setup)).not.toContain(privatePath);
    expect(setup).toMatchObject({
      current_step: "unknown",
      error: null,
      error_present: true,
      error_details_returned: false,
      projection: "support_safe_v1"
    });

    const source = supportImportSourceUrl({ kind: "local_git", host: "grid-control.internal", path: privatePath });
    expect(source).toMatchObject({
      kind: "local_git",
      host: null,
      host_configured: true,
      host_returned: false,
      path: null,
      path_configured: true,
      path_returned: false
    });
    expect(JSON.stringify(source)).not.toContain(privatePath);
    expect(JSON.stringify(source)).not.toContain("grid-control.internal");
  });

  test("keeps Grid publish state while withholding operation refs and receipt details", () => {
    const request: GridPublishRequest = {
      id: "grid_publish_public",
      app_id: "app_public",
      repo_id: "repo_public",
      account_ref: "account_public",
      workspace_ref: "workspace_public",
      deployment_id: "deployment_public",
      checkpoint_id: "checkpoint_public",
      commit_sha: "a".repeat(40),
      environment: "production",
      status: "repair_required",
      grid_operation_ref: `bittergrid://${boxRef}/private-operation`,
      preview_url: `${gridApi}/private-preview`,
      verification_status: "failed",
      repair_action: downstreamError,
      owner_plane: "BitterGrid",
      grid_receipt_id: "grid_receipt_public",
      callback_status: "failed",
      callback_received_at: "2026-08-21T00:00:00.000Z",
      grid_callback_json: null,
      created_at: "2026-08-21T00:00:00.000Z",
      updated_at: "2026-08-21T00:00:00.000Z"
    };
    const publish = gridPublishSupportJson(request);
    expect(publish).toMatchObject({
      commit_sha: "a".repeat(40),
      status: "repair_required",
      grid_operation_ref: null,
      grid_operation_linked: true,
      grid_operation_ref_returned: false,
      published_url_present: true,
      projection: "support_safe_v1"
    });
    expect(JSON.stringify(publish)).not.toContain(boxRef);
    expect(JSON.stringify(publish)).not.toContain(gridApi);
    expect(JSON.stringify(publish)).not.toContain(downstreamError);

    const receipt = receiptSupportJson({
      id: "rec_public",
      repo_id: "repo_public",
      deployment_id: "deployment_public",
      receipt_type: "grid_publish_callback",
      body: {
        grid_publish_request_id: request.id,
        app_id: request.app_id,
        repo_id: request.repo_id,
        deployment_id: request.deployment_id,
        checkpoint_id: request.checkpoint_id,
        commit_sha: request.commit_sha,
        environment: request.environment,
        status: request.status,
        owner_plane: request.owner_plane,
        grid_operation_ref: request.grid_operation_ref,
        published_url: request.preview_url,
        verification_status: request.verification_status,
        repair_action: downstreamError
      },
      created_at: "2026-08-21T00:00:00.000Z"
    });
    expect(receipt.body).toMatchObject({
      commit_sha: request.commit_sha,
      grid_operation_ref: null,
      grid_operation_linked: true,
      grid_operation_ref_returned: false,
      published_url: null,
      published_url_present: true,
      published_url_returned: false
    });
    expect(JSON.stringify(receipt)).not.toContain(boxRef);
    expect(JSON.stringify(receipt)).not.toContain(gridApi);
    expect(JSON.stringify(receipt)).not.toContain(downstreamError);

    const importReceipt = receiptSupportJson({
      id: "rec_import_public",
      repo_id: "repo_public",
      deployment_id: null,
      receipt_type: "git_import_app_setup",
      body: {
        app_id: "app_public",
        repo_id: "repo_public",
        commit_sha: "b".repeat(40),
        checkpoint_id: "checkpoint_public",
        import_summary: {
          source_kind: "git_url_import",
          source_url: { kind: "local_git", host: null, path: privatePath },
          default_branch: "main",
          branch_count: 1,
          tag_count: 0,
          upstream_relationship: "import_then_detach",
          sync_contract: "one_time_import_no_background_sync",
          upstream_after_import: { status: "detached", background_sync: false }
        }
      },
      created_at: "2026-08-21T00:00:00.000Z"
    });
    expect(JSON.stringify(importReceipt)).not.toContain(privatePath);
    expect(importReceipt.body).toMatchObject({
      import_summary: {
        source_url: { kind: "local_git", path: null, path_returned: false }
      }
    });
  });
});

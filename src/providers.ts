export type SourceProvider = {
  id: string;
  label: string;
  roles: string[];
  status: string;
  notes: string;
};

export const sourceProviders: SourceProvider[] = [
  {
    id: "github",
    label: "GitHub",
    roles: ["external_primary", "mirror", "projection_later"],
    status: "adapter_spike",
    notes: "Gate 11 records GitHub-shaped external-primary metadata without emulating GitHub APIs."
  },
  {
    id: "generic_git",
    label: "Generic Git",
    roles: ["import", "export", "source_only"],
    status: "active",
    notes: "Gate 12 supports ordinary Git remotes without issue or pull request assumptions."
  },
  {
    id: "gitlab",
    label: "GitLab",
    roles: ["external_primary_later", "mirror_later"],
    status: "next_provider",
    notes: "The next provider adapter after GitHub should be GitLab because it preserves familiar issue/merge-request concepts while broadening beyond GitHub."
  }
];

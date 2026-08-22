export type RefAuthorizer = (ref: string) => boolean;

export type RefUpdateForAuthorization = {
  ref: string;
  newSha: string;
};

export function unauthorizedRefs(refs: Iterable<string>, authorizeRef: RefAuthorizer): string[] {
  const denied: string[] = [];
  for (const ref of new Set(refs)) {
    if (!authorizeRef(ref)) denied.push(ref);
  }
  return denied;
}

export function unauthorizedUpdateRefs(
  updates: Iterable<RefUpdateForAuthorization>,
  authorizeRef: RefAuthorizer
): string[] {
  return unauthorizedRefs(Array.from(updates, (update) => update.ref), authorizeRef);
}

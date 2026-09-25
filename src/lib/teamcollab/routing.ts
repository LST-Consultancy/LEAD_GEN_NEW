/**
 * Who should own a plan step: someone with the step's required skill, not away, with room under
 * their step capacity — the least loaded first. Pure and deterministic, and it always says why,
 * including why nobody was chosen, because "unassigned" with no reason looks like a bug.
 */
export type RouteMember = { userId: string; name: string; skills: string[]; stepCapacity: number | null; isAway: boolean; openSteps: number };
export type RouteResult = { ownerId: string; reason: string } | { ownerId: null; reason: string };

const norm = (s: string) => s.trim().toLowerCase();
export const loadRatio = (m: RouteMember) => (m.stepCapacity ? m.openSteps / m.stepCapacity : m.openSteps / 1000);

export function suggestOwner(step: { requiredSkill: string | null }, members: RouteMember[]): RouteResult {
  const skill = step.requiredSkill ? norm(step.requiredSkill) : null;
  const skilled = skill ? members.filter(m => m.skills.map(norm).includes(skill)) : members;
  if (!skilled.length) return { ownerId: null, reason: skill ? `Nobody on the team has the skill “${step.requiredSkill}”. Add it to someone in Team & Roles.` : "There is nobody on the team to assign." };
  const present = skilled.filter(m => !m.isAway);
  if (!present.length) return { ownerId: null, reason: `Everyone with ${skill ? `“${step.requiredSkill}”` : "the needed skills"} is marked away.` };
  const withRoom = present.filter(m => m.stepCapacity === null || m.openSteps < m.stepCapacity);
  if (!withRoom.length) {
    const least = [...present].sort((a, b) => loadRatio(a) - loadRatio(b))[0];
    return { ownerId: null, reason: `Everyone who could take it is at capacity; the least loaded, ${least.name}, has ${least.openSteps} of ${least.stepCapacity} open steps.` };
  }
  const best = [...withRoom].sort((a, b) => loadRatio(a) - loadRatio(b) || a.openSteps - b.openSteps || a.name.localeCompare(b.name))[0];
  return { ownerId: best.userId, reason: `${best.name}${skill ? ` has “${step.requiredSkill}”` : ""} and the most room (${best.openSteps}${best.stepCapacity ? ` of ${best.stepCapacity}` : ""} open steps).` };
}

/** Assigns a batch in order, counting each assignment against the person before the next. */
export function planAssignments(steps: { id: string; title: string; requiredSkill: string | null }[], members: RouteMember[]) {
  const load = members.map(m => ({ ...m }));
  return steps.map(s => {
    const r = suggestOwner(s, load);
    if (r.ownerId) load.find(m => m.userId === r.ownerId)!.openSteps++;
    return { stepId: s.id, title: s.title, ...r };
  });
}

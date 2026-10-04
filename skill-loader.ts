// skill-loader: deferred skills. Removes the <available_skills> block from
// every provider request and replaces it with a one-line pointer listing only
// skill names; a `skill_load` tool returns the full menu or a skill's
// SKILL.md on demand. Motivation (measured on sanitize-git-repo, 3v3 reps):
// carrying unused skill descriptions in the prompt raised total tokens ~18%
// purely through distractor-driven extra tool calls, despite zero skill
// invocations. Skills themselves were never inputted — only advertised.
//
// Fail-open: on any surprise the payload goes out untouched, and the tool
// falls back to reporting paths so the model can read SKILL.md directly.

import { readFileSync } from "node:fs";
import { Type } from "typebox";

interface SkillEntry {
	name: string;
	description: string;
	location: string;
}

let skillsCache: SkillEntry[] | null = null;

const UNESCAPE: Record<string, string> = {
	"&amp;": "&",
	"&lt;": "<",
	"&gt;": ">",
	"&quot;": '"',
	"&apos;": "'",
};

function unescapeXml(s: string): string {
	let out = s;
	for (const [ent, ch] of Object.entries(UNESCAPE)) out = out.split(ent).join(ch);
	return out;
}

export function extractSkills(systemText: string): SkillEntry[] {
	const a = systemText.indexOf("<available_skills>");
	const b = systemText.indexOf("</available_skills>");
	if (a === -1 || b === -1 || b <= a) return [];
	const block = systemText.slice(a, b);
	const entries: SkillEntry[] = [];
	const skillRe = /<skill>([\s\S]*?)<\/skill>/g;
	for (const m of block.matchAll(skillRe)) {
		const body = m[1];
		const name = body.match(/<name>([\s\S]*?)<\/name>/)?.[1];
		const description = body.match(/<description>([\s\S]*?)<\/description>/)?.[1];
		const location = body.match(/<location>([\s\S]*?)<\/location>/)?.[1];
		if (!name || !description || !location) continue;
		entries.push({ name: unescapeXml(name.trim()), description: unescapeXml(description.trim()), location: unescapeXml(location.trim()) });
	}
	return entries;
}

function pointerLine(entries: SkillEntry[]): string {
	if (entries.length === 0) return "";
	return `Skills available (not loaded): ${entries.map((s) => s.name).join(", ")}. Call the skill_load tool with a name to load a skill's full instructions before relying on it.`;
}

function stripSkills(text: string): string {
	const entries = extractSkills(text);
	if (entries.length === 0) return text;
	skillsCache = entries;
	const a = text.indexOf("<available_skills>");
	const b = text.indexOf("</available_skills>") + "</available_skills>".length;
	return text.slice(0, a) + pointerLine(entries) + text.slice(b);
}

function menuText(entries: SkillEntry[]): string {
	return entries
		.map((s) => `### ${s.name}\n${s.description}\nFile: ${s.location}`)
		.join("\n\n");
}

export default function (pi: any) {
	// SKILL_LOADER=off: A/B switch — skills stay in the prompt as pi built them
	// (no stripping, no skill_load tool) so deferred vs in-prompt can be compared.
	if (process.env.SKILL_LOADER === "off") return;
	pi.registerTool({
		name: "skill_load",
		label: "Load Skill",
		description:
			"List available skills (no arguments) or load one skill's full instructions by name. " +
			"Call it when the current task might match a skill — the prompt only shows skill names, not what they do.",
		promptSnippet: "Load full instructions for an available skill",
		parameters: Type.Object({
			name: Type.Optional(
				Type.String({ description: "Skill name. Omit to list all skills with full descriptions." }),
			),
		}),
		async execute(_toolCallId: string, params: { name?: string }) {
			const entries = skillsCache ?? [];
			if (!params.name) {
				if (entries.length === 0) {
					return { content: [{ type: "text", text: "No skills are currently available." }] };
				}
				return { content: [{ type: "text", text: menuText(entries) }] };
			}
			const wanted = params.name.trim().toLowerCase();
			const skill =
				entries.find((s) => s.name.toLowerCase() === wanted) ??
				entries.find((s) => s.name.toLowerCase().startsWith(wanted));
			if (!skill) {
				const names = entries.length > 0 ? entries.map((s) => s.name).join(", ") : "(none)";
				return {
					content: [{ type: "text", text: `Unknown skill "${params.name}". Available: ${names}` }],
				};
			}
			try {
				const md = readFileSync(skill.location, "utf8");
				return { content: [{ type: "text", text: `[skill: ${skill.name}]\n\n${md}` }] };
			} catch (error) {
				const reason = error instanceof Error ? error.message : String(error);
				return {
					content: [
						{
							type: "text",
							text: `Could not read ${skill.location} (${reason}).\n\nDescription: ${skill.description}`,
						},
					],
				};
			}
		},
	});

	pi.on("before_provider_request", (event: { payload: unknown }) => {
		try {
			const payload = event?.payload as Record<string, unknown> | undefined;
			if (!payload) return;
			const strip = (text: string) => stripSkills(text);
			if (typeof payload.system === "string") {
				payload.system = strip(payload.system);
			} else if (Array.isArray(payload.system)) {
				for (const part of payload.system) {
					if (part && typeof part === "object" && typeof (part as Record<string, unknown>).text === "string") {
						(part as Record<string, unknown>).text = strip((part as Record<string, unknown>).text as string);
					}
				}
			}
			if (Array.isArray(payload.messages)) {
				for (const m of payload.messages) {
					if (!m || typeof m !== "object" || (m as Record<string, unknown>).role !== "system") continue;
					const content = (m as Record<string, unknown>).content;
					if (typeof content === "string") {
						(m as Record<string, unknown>).content = strip(content);
					} else if (Array.isArray(content)) {
						for (const c of content) {
							if (c && typeof c === "object" && typeof (c as Record<string, unknown>).text === "string") {
								(c as Record<string, unknown>).text = strip((c as Record<string, unknown>).text as string);
							}
						}
					}
				}
			}
		} catch {
			// a loader bug must never break the request — payload stays as pi built it
		}
	});
}

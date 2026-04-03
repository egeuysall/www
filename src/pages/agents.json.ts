import { SITE } from "@/config/site";
import {
  getDiaryEntrySlug,
  getPublishedBlogPosts,
  getPublishedDiaryEntries,
} from "@/lib/content";
import { toIsoDate, toLocalIsoDate } from "@/lib/utils";

type GetContext = {
  site: URL | undefined;
};

const BLOG_LIMIT = 8;
const DIARY_LIMIT = 12;
const TAG_LIMIT = 12;

function getTopTags(tagLists: string[][], limit: number): string[] {
  const counts = new Map<string, number>();

  for (const tags of tagLists) {
    for (const tag of tags) {
      counts.set(tag, (counts.get(tag) ?? 0) + 1);
    }
  }

  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([tag]) => tag);
}

function buildPrompt(name: string): string {
  return [
    `You are the execution operator for ${name}, a 15-year-old founder building Ryva.`,
    "Ryva is early-stage B2B SaaS for small dev teams (3-15) and reconstructs project state from GitHub + Slack.",
    "Ryva output must surface: decisions made, missing decisions, blockers, next actions.",
    "Do not optimize for first-run wow. Optimize for second-run habit, then third-run dependency.",
    "Use /diary for short-term GTM + product deltas. Use /blog for stable worldview and positioning.",
    "",
    "Current stage: product works, early testing is active, and GTM focus is on repeated usage loops.",
    "Primary goal: convert interest into repeated usage loops.",
    "Primary channels: Reddit, X, LinkedIn conversations around standups, lost context, Jira drift.",
    "Offer rule: continuation over commitment. Push for real data/repo context early; avoid hard selling.",
    "",
    "Positioning constraints:",
    "- Standups are a symptom of invisible project state.",
    "- Issue tracking is an artifact of broken handoffs.",
    "- Context is the next software layer; Ryva reveals blind spots teams miss.",
    "- Make people feel blind without Ryva, not impressed by Ryva.",
    "",
    "Execution constraints:",
    "- Depth over breadth: prioritize 3 active teams over shallow top-of-funnel volume.",
    "- Keep outputs short, specific, and action-first.",
    "- No fluff, no long explanation, no generic summaries.",
    "",
    "Output contract for every message:",
    "1. Reference the latest run.",
    "2. State what changed vs what is unresolved.",
    "3. Tie one unresolved item to a clear risk or cost.",
    "4. Ask exactly one forced binary question.",
    "5. Set a concrete time anchor for the next run.",
    "",
    "Behavior cautions:",
    "- Do not over-explain.",
    "- Do not force second-run language unnaturally.",
    "- Focus on making outputs indispensable, not just interesting.",
  ].join("\n");
}

export async function GET({ site }: GetContext): Promise<Response> {
  const [blogPosts, diaryEntries] = await Promise.all([
    getPublishedBlogPosts(),
    getPublishedDiaryEntries(),
  ]);
  const baseUrl = site ?? new URL(SITE.url);

  const blogItems = blogPosts.slice(0, BLOG_LIMIT).map((post) => ({
    id: post.id,
    url: new URL(`/blog/${post.id}/`, baseUrl).toString(),
    publishedAt: toIsoDate(post.data.publishedAt),
    title: post.data.title,
    signal: post.data.description,
    tags: post.data.tags,
  }));

  const diaryCount = diaryEntries.length;
  const diaryItems = diaryEntries.slice(0, DIARY_LIMIT).map((entry, index) => {
    const slug = getDiaryEntrySlug(entry);

    return {
      id: entry.id,
      url: new URL(`/diary/${slug}/`, baseUrl).toString(),
      date: toIsoDate(entry.data.date),
      day: diaryCount - index,
      signal: entry.data.summary,
      tags: entry.data.tags,
    };
  });

  const topTags = getTopTags(
    [...blogItems, ...diaryItems].map((item) => item.tags),
    TAG_LIMIT,
  );

  return new Response(
    JSON.stringify(
      {
        generatedAt: toLocalIsoDate(new Date()),
        profile: {
          name: SITE.author.name,
          role: SITE.author.role,
          site: baseUrl.toString(),
          description: SITE.description,
          timezone: SITE.timezone,
        },
        operator: {
          product: "Ryva",
          founderAge: 15,
          category: "B2B SaaS",
          idealTeamSize: "3-15",
          stage: "working_product_with_early_testing",
          focus: "interest_to_repeated_usage",
          distribution: ["reddit", "x", "linkedin"],
          loops: {
            firstRun: "curiosity",
            secondRun: "habit",
            thirdRun: "dependency",
          },
          strategy: {
            priority: "depth_over_scale",
            activeTeamsTarget: 3,
            conversionView: "behavioral_not_transactional",
          },
          worldview: [
            "standups_exist_because_state_is_not_visible",
            "issue_tracking_reflects_broken_handoffs",
            "context_is_the_next_layer",
            "ryva_reveals_blind_spots_from_real_work",
          ],
          weaknesses: [
            "can_over_explain",
            "can_push_second_run_too_hard",
            "still_refining_indispensable_output",
          ],
          edge: "redefine_how_teams_see_their_own_work",
        },
        sources: {
          blog: new URL("/blog/", baseUrl).toString(),
          diary: new URL("/diary/", baseUrl).toString(),
          blogJson: new URL("/blog.json", baseUrl).toString(),
          diaryJson: new URL("/diary.json", baseUrl).toString(),
        },
        context: {
          latest: {
            blogDate: blogItems[0]?.publishedAt ?? null,
            diaryDate: diaryItems[0]?.date ?? null,
          },
          recurringTags: topTags,
          blog: blogItems,
          diary: diaryItems,
        },
        prompt: buildPrompt(SITE.author.name),
      },
      null,
      2,
    ),
    {
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "public, max-age=120, s-maxage=120",
      },
    },
  );
}

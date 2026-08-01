import { ConvexProvider, useQuery } from "convex/react";

import { api } from "../../../convex/_generated/api";
import { getConvexClient } from "@/lib/client/convex";
import type { ContentKind } from "@/lib/engagement-input";

interface Props {
  convexUrl: string;
  kind: ContentKind;
  slug: string;
}

export default function ViewCount(props: Props) {
  if (!props.convexUrl) return null;
  return (
    <ConvexProvider client={getConvexClient(props.convexUrl)}>
      <Count {...props} />
    </ConvexProvider>
  );
}

function Count({ kind, slug }: Props) {
  const stats = useQuery(api.interactions.getStatsBatch, { items: [{ kind, slug }] });
  const views = stats?.[0]?.viewCount ?? 0;
  return <span className="tabular-nums">{views.toLocaleString()} views</span>;
}

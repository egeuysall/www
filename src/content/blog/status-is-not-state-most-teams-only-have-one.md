---
title: "Status is not state. Most teams only have one."
description: "Every team tracks what people worked on. Almost none track what is actually happening. The difference is costing you more than you think."
publishedAt: 2026-03-21
tags: ["startups", "saas", "story"]
image: "https://images.pexels.com/photos/1595391/pexels-photo-1595391.jpeg"
---

I learned the difference the hard way.

A teammate told me they were working on the dropdown tasks for the terminal. I nodded. They explained further. I still did not really understand until I saw it in production and it was broken.

Not because they did not communicate. They did. The status was clear. What I lacked was state.

## The difference

Status is what people did.

> Merged the PR. Fixed the contrast issue. Updated the terminal layout.

State is what is actually happening.

> The terminal backend has no public hosting target. The Docker socket is mounted and nobody owns the security review. We have no CI pipeline. Three contributors are shipping directly to main.

Both of those describe the same project. One tells you what changed. The other tells you where you actually are.

Most teams only have the first one.

## Why this happens

I spent two weeks talking to engineering managers and founders about how their teams track work. Over a hundred conversations across Reddit and Slack communities.

Almost everyone described the same thing.

Updates happen in Slack. PRs get merged. Standups happen. People report what they did. And at the end of the week, if you ask what the actual state of the project is, someone has to reconstruct it manually from memory and scattered threads.

The reason is mostly habit. People have been trained to report activity. What did you work on? What did you ship? What is blocked?

But those questions are about status. Nobody asks the harder question: where are we actually right now, and what has nobody decided yet?

Most people do not even have a framework for answering that. It is not a failure of communication. It is that state is a different kind of information and most tools are not built to surface it.

## What it costs

When teams only have status and not state, a few things happen consistently.

Duplicate or conflicting decisions get made because nobody can see what has already been decided. Blockers stay hidden because status updates do not reveal missing decisions. Problems surface only when work is already delayed. Meetings turn into reconstruction sessions instead of forward progress. Ownership drifts. Priorities drift. The illusion of progress exists while the actual project direction stays unclear.

The most expensive version of this is a team that is shipping steadily but building in the wrong direction because nobody had a clear view of what decisions were missing three weeks ago.

## What state actually looks like

When I ran Ryva on the CyberMinds repo, a nonprofit cybersecurity education platform I help build, the agent did not just tell me what changed recently.

It told me where we actually were.

```md
Decisions made:

- CTF challenges now enforce sequential completion
- Terminal switcher layout improved
- WCAG contrast fixed for opportunity-card component

Missing decisions:

- No hosting target defined for the Go backend terminal
- No decision on who owns CTF challenge authoring
- No CI pipeline or automated testing
- No owner assigned for terminal security review
- Docker socket mounted with no security review completed
- No distribution strategy for reaching students
```

None of that required a meeting. None of it required anyone to write a status update. It came from reading what already existed in the repo and asking a different question than "what changed" and instead asking "what is the actual situation right now."

The status was clear from the commits. The state required surfacing what was missing, unowned, and undecided.

## The shift

Teams that operate from shared state rather than individual status updates work differently.

Discussions focus on resolving gaps rather than reporting updates. Ownership is explicit because each next action has a named owner. Meetings become optional for the parts that do not require real-time conversation. Context does not need to be reconstructed because it is always visible.

The goal is not to eliminate updates. It is to make the project state visible automatically so updates become a choice rather than a requirement for anyone to understand what is happening.

Status tells you what happened. State tells you where you are.

Most tools are built for the first one. That is the gap Ryva is built to close.

If you want to see what state visibility actually looks like on a real repo, the demo runs on the Supabase codebase at [ryva.dev/demo](https://ryva.dev/demo) with no signup required.

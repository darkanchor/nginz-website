---
title: Hello, World
description: The first post on the darkanchor engineering blog — what this space is for, what we build, and what kind of writing to expect.
date: 2025-05-16
author: darkanchor team
---

# Hello, World

Welcome to the darkanchor engineering blog. This is where we write about the things we build, the problems we solve, and the decisions we make along the way.

## What we build

We build infrastructure software that runs at the edge — literally, inside nginx. Our products span three layers:

- **nginz** — native modules for stock nginx. Health checks, dynamic upstreams, JWT auth, circuit breakers, Prometheus metrics. The stuff that turns a reverse proxy into a production edge platform, without a fork, without a SaaS dependency.
- **nginz-njs** — scripted policy in Gleam, compiled to JavaScript, running inside the njs engine. Composable authorization, feature flags, response transformation, HTTP orchestration. Policy as code, at the edge.
- **nginz-token** — an AI gateway that also lives inside nginx. Token-level rate limiting, per-user cost tracking, semantic caching, prompt security. No separate proxy service. No third party sees your prompts.

All three run on stock nginx. That's the constant: you already have nginx. We make it do more.

## What to expect here

This blog will cover:

- **Design decisions** — why we chose Zig for native modules, why Gleam for scripted policy, why a single-process architecture matters for AI gateways.
- **Technical deep dives** — how circuit breakers work inside nginx, how semantic caching cuts API bills, how cross-worker event rings keep distributed state coherent.
- **Release notes and changelogs** — what's new, what's changed, what's coming.
- **Operational stories** — lessons from running edge infrastructure in production, patterns we've seen, mistakes we've made.

If you're building on nginx, running LLMs in production, or thinking about edge infrastructure, this space is for you.

Stay tuned.

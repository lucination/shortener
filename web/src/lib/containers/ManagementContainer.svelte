<script lang="ts">
  import { recentRange, selectedPeriod } from "../statistics";
  import { onMount, untrack } from "svelte";
  import { createApi, type Api } from "../adapters/api";
  import { managementPath } from "../management";
  import { linkDraft, statsView } from "../mappings";
  import { parseDraft } from "../adapters/draft";
  import { failureOutcome, resultResource } from "../resource";
  import type { Link } from "../generated";
  import type {
    LinkDraft,
    AnalyticsView,
    DateRange,
    Outcome,
  } from "../view-models";
  import Analytics from "../Analytics.svelte";
  import LinkEditor from "../LinkEditor.svelte";
  import ResourceStatus from "../ResourceStatus.svelte";
  import ManagementFrame from "../ManagementFrame.svelte";
  import FocusedModal from "../presentation/FocusedModal.svelte";
  import ActionForm from "../ActionForm.svelte";
  let {
    api = createApi(fetch),
    navigate = (path: string) => location.assign(path),
    now = () => new Date(),
  }: {
    api?: Api;
    navigate?: (path: string) => void;
    now?: () => Date;
  } = $props();
  type Page =
    | { kind: "loading" }
    | { kind: "not-found" }
    | { kind: "failed"; message: string }
    | { kind: "statistics"; link: Link; view: AnalyticsView }
    | { kind: "edit"; link: Link; draft: LinkDraft };
  let page: Page = $state({ kind: "loading" });
  let outcome: Outcome = $state({ kind: "idle" });
  let confirmation: "none" | "remove-password" = $state("none");
  let clock = $state(untrack(() => now()));
  let range: DateRange = $state(untrack(() => recentRange(7, clock)));
  let generation = 0;
  const back = () => navigate("/");
  const denied = (error: import("../adapters/api").ApiError) =>
    error.kind === "http" && [401, 403, 404].includes(error.status);
  async function load() {
    const route = managementPath(location.pathname);
    if (!route) {
      page = { kind: "not-found" };
      return;
    }
    const request = ++generation;
    page = { kind: "loading" };
    const result = await api.links();
    if (request !== generation) return;
    if (result.kind === "failed") {
      page = denied(result.error)
        ? { kind: "not-found" }
        : { kind: "failed", message: result.error.message };
      return;
    }
    const link = result.value.items.find(
      (link) =>
        !link.deleted_at &&
        link.addresses.some(
          (address) =>
            address.domain_id === 1 && address.short_code === route.code,
        ),
    );
    if (!link) {
      page = { kind: "not-found" };
      return;
    }
    if (route.kind === "edit")
      page = { kind: "edit", link, draft: linkDraft(link) };
    else {
      page = {
        kind: "statistics",
        link,
        view: {
          kind: "stats",
          label: link.title || route.code,
          state: { kind: "pending" },
        },
      };
      await loadStats();
    }
  }
  async function loadStats() {
    if (page.kind !== "statistics") return;
    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(range.from) ||
      !/^\d{4}-\d{2}-\d{2}$/.test(range.to) ||
      range.from > range.to
    ) {
      outcome = {
        kind: "error",
        message: "Choose a valid inclusive date range.",
      };
      return;
    }
    const target = page;
    const request = ++generation;
    outcome = { kind: "idle" };
    page = { ...target, view: { ...target.view, state: { kind: "pending" } } };
    const result = await api.stats(target.link.id, range);
    if (request !== generation) return;
    if (result.kind === "failed" && denied(result.error)) {
      page = { kind: "not-found" };
      return;
    }
    page = {
      ...target,
      view: {
        kind: "stats",
        label: target.view.label,
        state: resultResource(result, statsView),
      },
    };
  }
  async function save() {
    if (page.kind !== "edit" || outcome.kind === "pending") return;
    const parsed = parseDraft(page.draft);
    if (parsed.kind === "invalid") {
      outcome = { kind: "error", message: parsed.message };
      return;
    }
    const request = ++generation;
    outcome = { kind: "pending" };
    // Omit unchanged fields: datetime-local cannot represent stored fractional seconds,
    // and an unrelated title edit must not rewrite expiration or hidden settings.
    const original = linkDraft(page.link);
    const patch = { ...parsed.patch };
    const fields = {
      destination: "destination",
      title: "title",
      description: "description",
      password: "password",
      expires_at: "expiresAt",
      click_limit: "clickLimit",
      retention_days: "retentionDays",
      interstitial: "interstitial",
      query_mode: "queryMode",
    } as const;
    for (const key of Object.keys(fields) as (keyof typeof fields)[]) {
      const field = fields[key];
      if (original[field] === page.draft[field]) delete patch[key];
    }
    const result = await api.patch(page.link.id, patch);
    if (request !== generation) return;
    if (result.kind === "ok") back();
    else if (denied(result.error)) page = { kind: "not-found" };
    else outcome = failureOutcome(result.error);
  }
  async function removePassword() {
    if (page.kind !== "edit" || outcome.kind === "pending") return;
    const request = ++generation;
    const target = page;
    outcome = { kind: "pending" };
    const result = await api.patch(target.link.id, { password: null });
    if (request !== generation) return;
    if (result.kind === "ok") {
      confirmation = "none";
      page = { ...target, link: result.value };
      outcome = { kind: "success", message: "Password removed." };
    } else if (denied(result.error)) page = { kind: "not-found" };
    else outcome = failureOutcome(result.error);
  }
  onMount(() => {
    void load();
    return () => {
      generation++;
    };
  });
</script>

<ManagementFrame
  identity={page.kind === "edit" || page.kind === "statistics"
    ? {
        label: page.link.title || page.link.addresses[0]?.short_code || "Link",
        address: `${page.link.addresses[0]?.domain}/${page.link.addresses[0]?.short_code}`,
        destination: page.link.destination,
      }
    : undefined}
>
  {#if page.kind === "not-found"}<section class="public-page stack">
      <h1>Link not found</h1>
      <p>This link is unavailable.</p>
      <a href="/">Back to links</a>
    </section>
  {:else if page.kind === "loading"}<ResourceStatus
      state={{ kind: "pending" }}
    />
  {:else if page.kind === "failed"}<ResourceStatus
      state={{ kind: "error", message: page.message }}
      onretry={load}
    />
  {:else}
    {#if page.kind === "statistics"}<ResourceStatus state={outcome} /><Analytics
        view={page.view}
        {range}
        onrange={(value) => (range = value)}
        onapply={loadStats}
        period={selectedPeriod(range, clock)}
        onperiod={(days) => {
          clock = now();
          range = recentRange(days, clock);
          void loadStats();
        }}
        onback={back}
      />
    {:else}<LinkEditor
        mode={{ kind: "edit", id: page.link.id }}
        draft={page.draft}
        {outcome}
        onchange={(draft) => {
          if (page.kind === "edit") page = { ...page, draft };
        }}
        onsubmit={save}
        oncancel={back}
      />
      {#if page.link.password_protected}<button
          class="password-removal"
          disabled={outcome.kind === "pending"}
          onclick={() => {
            outcome = { kind: "idle" };
            confirmation = "remove-password";
          }}>Remove existing password</button
        >{/if}
      {#if confirmation === "remove-password"}<FocusedModal
          onclose={() => {
            if (outcome.kind !== "pending") confirmation = "none";
          }}
          ><ActionForm
            view={{
              kind: "confirm",
              title: "Remove link password?",
              description:
                "Anyone with the address will be able to open this link.",
            }}
            {outcome}
            onconfirm={removePassword}
            oncancel={() => {
              if (outcome.kind !== "pending") confirmation = "none";
            }}
          /></FocusedModal
        >{/if}
    {/if}
  {/if}
</ManagementFrame>

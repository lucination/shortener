<script lang="ts">
  import type { AdminView, UserAction, Outcome } from "./view-models";
  import ResourceStatus from "./ResourceStatus.svelte";
  import EventTable from "./EventTable.svelte";
  import Dashboard from "./Dashboard.svelte";
  let {
    view,
    outcome,
    onuser = () => {},
    oncreate = () => {},
    onretry = () => {},
  }: {
    view: AdminView;
    outcome: Outcome;
    onuser?: (action: UserAction, id: number) => void;
    oncreate?: () => void;
    onretry?: () => void;
  } = $props();
</script>

<section class="stack">
  {#if view.kind !== "links"}<div class="toolbar spread">
      <div>
        <h1>
          {view.kind === "users"
            ? "Users"
            : view.kind === "usage"
              ? "Usage"
              : "Events"}
        </h1>
      </div>
      {#if view.kind === "users"}<button class="btn-primary" onclick={oncreate}
          >+ Add user</button
        >{/if}
    </div>{/if}
  <ResourceStatus state={outcome} />{#if view.kind !== "links"}<ResourceStatus
      state={view.state}
      {onretry}
    />{/if}
  {#if view.kind === "users" && view.state.kind === "ready"}{#if !view.state.value.length}<div
        class="box-frame"
      >
        No users yet. Add an email address to grant access.
      </div>{:else}<div class="table-scroll">
        <table class="grid-table">
          <thead
            ><tr
              ><th class="frozen-identity">User</th><th>Status</th><th
                >Link quota</th
              ><th>Retention</th><th>Actions</th></tr
            ></thead
          ><tbody
            >{#each view.state.value as user (user.id)}<tr
                ><td class="frozen-identity"
                  ><strong title={user.email}>{user.email}</strong><br /><span
                    class="muted">#{user.id}</span
                  ></td
                ><td>{user.status}</td><td
                  ><button onclick={() => onuser("quota", user.id)}
                    >{user.quota}</button
                  ></td
                ><td
                  ><button onclick={() => onuser("retention", user.id)}
                    >{user.retention} days</button
                  ></td
                ><td
                  ><div class="toolbar">
                    {#if user.status === "active"}<button
                        onclick={() => onuser("suspend", user.id)}
                        >Suspend</button
                      >{:else}<button
                        onclick={() => onuser("reactivate", user.id)}
                        >Reactivate</button
                      >{/if}<button onclick={() => onuser("signout", user.id)}
                      >Sign out everywhere</button
                    ><button onclick={() => onuser("delete", user.id)}
                      >Soft delete</button
                    >
                  </div></td
                ></tr
              >{/each}</tbody
          >
        </table>
      </div>{/if}
    <p class="muted">
      Suspended or deleted users cannot redirect links. Soft-deleted accounts
      remain recoverable.
    </p>
  {:else if view.kind === "events" && view.state.kind === "ready"}<EventTable
      rows={view.state.value}
    />
  {:else if view.kind === "links"}<Dashboard
      state={view.state}
      mode="read-only"
      {onretry}
    />
  {:else if view.kind === "usage" && view.state.kind === "ready"}<div
      class="metric-grid"
    >
      {#each view.state.value as metric}<div>
          <div class="muted">{metric.label}</div>
          <div class="metric-value">{metric.count.toLocaleString()}</div>
        </div>{/each}
    </div>
  {/if}
</section>

# Available Tools

## Projects
| Tool | Description |
|------|-------------|
| `list_projects` | List all projects in the organization |
| `get_project` | Get full details of a project by ID or name |

## Work Items
| Tool | Description |
|------|-------------|
| `create_work_item` | Create a work item (supports description, assignee, priority, tags, area/iteration path, parent) |
| `get_work_item` | Get all fields of a work item by ID |
| `update_work_item` | Apply JSON Patch field updates to a work item |
| `list_work_items` | List work items with optional filters (type, state, assignee, sprint, area path) |
| `delete_work_item` | Move a work item to the recycle bin |
| `add_comment` | Add a comment to a work item |
| `get_work_item_history` | Get full revision history of a work item |
| `bulk_create_work_items` | Create multiple work items in one call; returns per-item success/error |
| `link_work_items` | Create a relation between two work items |

## Boards & Sprints
| Tool | Description |
|------|-------------|
| `list_boards` | List all boards for a team |
| `get_board_columns` | Get columns (with WIP limits) for a board |
| `list_sprints` | List all sprints for a team (past, current, future) |
| `get_current_sprint` | Get the currently active sprint for a team |
| `get_sprint_work_items` | Get all work items assigned to a sprint |

## Pipelines
| Tool | Description |
|------|-------------|
| `list_pipelines` | List all pipeline definitions in a project |
| `get_pipeline` | Get full details of a pipeline |
| `run_pipeline` | Trigger a pipeline run (supports branch and variables) |
| `get_pipeline_runs` | Get run history for a pipeline |
| `get_pipeline_run_details` | Get detailed run info including stages/jobs/steps |

## Repositories & Git
| Tool | Description |
|------|-------------|
| `list_repositories` | List all Git repositories in a project |
| `get_repository` | Get full details of a repository |
| `list_pull_requests` | List PRs with optional filters (status, author, source branch) |
| `get_pull_request` | Get full PR details including reviewers and linked work items |
| `create_pull_request` | Create a PR (supports description, reviewers, work item links) |
| `list_commits` | List commits with optional author and date filters |
| `get_file_content` | Get raw file content from a repository |

## Teams
| Tool | Description |
|------|-------------|
| `list_teams` | List all teams in a project |
| `get_team_members` | Get all members of a team |

## WIQL Queries
| Tool | Description |
|------|-------------|
| `run_wiql_query` | Execute a custom WIQL query and return matching work items |
| `list_saved_queries` | List all saved queries in a project |

## Analytics
| Tool | Description |
|------|-------------|
| `get_cycle_time` | Avg/median/min/max cycle time in days by work item type for a date range |
| `get_lead_time` | Avg/median/min/max lead time in days by work item type for a date range |
| `get_team_throughput` | Completed work items per week, broken down by type |
| `get_velocity_history` | Story points and item count completed per sprint (last N sprints) |
| `get_sprint_burndown` | Daily burndown dataset with remaining work and ideal burndown |
| `get_quality_metrics` | Bug reopen rate, MTTR, stale PRs count, stories without acceptance criteria |
| `get_work_distribution` | Completed work items count and percentage per team member |

## Reports
| Tool | Description |
|------|-------------|
| `get_sprint_summary` | Planned vs completed items/story points, carry-overs, bugs opened/closed |
| `generate_release_notes` | Closed work items grouped by type; supports markdown or html format |
| `get_incomplete_items_report` | Incomplete work items with days open |

## Bulk Operations
| Tool | Description |
|------|-------------|
| `bulk_move_sprint_items` | Move all items from one sprint to another (with optional state/type filters) |
| `bulk_reassign_work_items` | Reassign all items from one assignee to another |
| `bulk_close_work_items` | Close all items by ID list or WIQL query |
| `bulk_apply_tags` | Add or remove a tag on all matching work items |
| `bulk_update_field` | Update a field value on all items by ID list or WIQL query |

## Templates & Scaffolding
| Tool | Description |
|------|-------------|
| `create_sprint_from_template` | Create a sprint from a JSON template (name, dates, goal) |
| `scaffold_epic_hierarchy` | Create Epic → Features → User Stories with parent-child links |
| `duplicate_sprint_structure` | Copy item types/titles from one sprint to another (no assignee/state/points) |
| `list_work_item_templates` | List all work item templates for a team |
| `create_from_work_item_template` | Create a work item from a template with optional field overrides |

## Daily Standup
| Tool | Description |
|------|-------------|
| `get_standup_summary` | Structured standup data: done since last business day, in-progress, blocked — grouped by assignee |
| `export_standup_agenda` | Markdown-formatted standup agenda ready to paste in Slack or Teams |

## Audit, Alerts & Compliance
| Tool | Description |
|------|-------------|
| `get_blocked_items_alert` | Work items blocked/tagged "impedimento" for more than BLOCKED_ITEM_DAYS days |
| `get_sprint_health_alert` | Sprint risk level (low/medium/high) based on completion vs elapsed time |
| `get_stale_prs_alert` | Open PRs without activity for more than STALE_PR_DAYS days |
| `get_failing_pipelines_alert` | Pipelines with FAILING_PIPELINE_THRESHOLD or more consecutive failures |
| `get_audit_log` | Chronological field-change log per work item (by ID list or date range) |
| `get_items_without_estimation` | Work items with no story points and no effort value |
| `get_prs_without_required_review` | Merged PRs that lacked the required number of approvals |
| `get_items_without_acceptance_criteria` | User Stories with empty acceptance criteria field |

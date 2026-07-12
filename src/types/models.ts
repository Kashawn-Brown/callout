/** Row shapes for tables the client reads directly (reads only — all writes go through RPCs per CLAUDE.md §2.2). Only fields the app currently consumes are typed; add fields as phases activate them. */

export type Profile = {
  id: string;
  display_name: string;
  avatar_url: string | null;
};

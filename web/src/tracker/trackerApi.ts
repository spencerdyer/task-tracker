// The tracker's HTTP API: projects, tickets and their history, questions, the project chat, machines,
// project access tokens, and which projects this viewer shows at once.
import { http } from '../lib/http';

export type Status = 'todo' | 'in_progress' | 'testing' | 'uat' | 'done';
export type Priority = 'P0' | 'P1' | 'P2' | 'P3';

export const STATUSES: { key: Status; name: string; short: string }[] = [
  { key: 'todo', name: 'To do', short: 'To do' },
  { key: 'in_progress', name: 'In progress', short: 'Doing' },
  { key: 'testing', name: 'Testing', short: 'Testing' },
  { key: 'uat', name: 'User acceptance', short: 'Review' },
  { key: 'done', name: 'Done', short: 'Done' },
];
export const PRIORITIES: Priority[] = ['P0', 'P1', 'P2', 'P3'];
export const statusName = (s: string) => STATUSES.find((x) => x.key === s)?.name ?? s;

export interface Project {
  key: string;
  name: string;
  description: string;
  counts: Partial<Record<Status, number>>;
  awaiting_review: number;
}

export interface TicketSummary {
  key: string;
  title: string;
  scope: string;
  acceptance: string;
  priority: Priority;
  owner: string;
  labels: string[];
  depends_on: string[];
  /** Shared machines it needs */
  resources?: string[];
  /** Machines it needs that other tickets hold right now (to-dos only) */
  waiting_for?: { resource: string; name: string; held_by: string[] }[];
  status: Status;
  rank: number;
  reopened: number;
  created: number;
  updated: number;
  attention: boolean;
  counts: Record<string, number>;
  attachments: number;
  /** Agents' questions on it: open = waiting for the owner, answered = waiting for the agent */
  questions?: { open: number; answered: number };
}

export interface Attachment { id: string; filename: string; mime: string; size: number; url: string }

export interface TicketEvent {
  id: number;
  ts: number;
  author: string;
  kind: 'created' | 'status' | 'comment' | 'note' | 'verification' | 'edit';
  body: string;
  status_from: Status | null;
  status_to: Status | null;
  token: string | null;
  attachments: Attachment[];
}

export interface TicketLink { key: string; title: string; status: Status }

export interface Ticket extends TicketSummary {
  project: { key: string; name: string };
  events: TicketEvent[];
  dependencies: TicketLink[];
  blocks: TicketLink[];
}

export interface ResourceHolder { ticket: string; title: string; owner: string; status: Status; since: number }
export interface Resource { key: string; name: string; description: string; busy: boolean; holders: ResourceHolder[] }

export interface AgentTicket { key: string; title: string; status: Status; priority: Priority; updated: number; resources: string[] }
export interface AgentRow {
  name: string;
  current: AgentTicket[];
  in_review: AgentTicket[];
  idle: boolean;
  last_activity: { ticket: string; title: string; what: string; ts: number } | null;
}
export interface AgentsOverview {
  agents: AgentRow[];
  startable_unclaimed: { key: string; title: string; priority: Priority }[];
  /** Reviews and tickets with an open question; blocked:user tickets with none, apart */
  waiting_on_user: { count: number; review: { key: string; title: string; owner: string }[];
    asked?: { key: string; title: string; status: Status; owner: string }[];
    unasked?: { key: string; title: string; status: Status; owner: string }[] };
}

// An agent's question to the owner on a ticket
export type QuestionStatus = 'open' | 'answered' | 'resolved' | 'withdrawn';
export interface QuestionOption { label: string; detail: string }
export interface QuestionReply { id: number; ts: number; author: string; body: string; choice: string | null; token: string | null }
export interface Question {
  id: number;
  ticket: { key: string; title: string; status: Status; owner: string };
  asked_by: string;
  title: string;
  body: string;  // Markdown
  options: QuestionOption[];
  recommended: string | null;
  status: QuestionStatus;
  created: number;
  updated: number;
  waiting_since: number;
  answered_at: number | null;
  closed_at: number | null;
  closed_by: string | null;
  reply_count: number;
  last_reply: { author: string; ts: number; choice: string | null; preview: string } | null;
  chosen: string | null;
  replies?: QuestionReply[];
}

// Everything waiting on the owner, asked properly: agents' questions and reviews; nothing guessed
// from scopes or the chat (the server still sends `decisions` and `questions`, empty, for older app builds)
export interface Unasked { key: string; title: string; status: Status; owner: string; priority: Priority; since: number }
export interface WaitingOnYou {
  /** Questions and reviews: what waits on the owner */
  count: number;
  /** Agents' open questions, waiting longest first */
  asked?: Question[];
  review: { key: string; title: string; owner: string; priority: Priority; since: number; waiting_hours: number }[];
  /** blocked:user tickets whose agent hasn't asked its question yet: shown, not counted */
  unasked?: Unasked[];
}

// The project chat between the owner and the agents
export interface ChatTicket { key: string; title: string; status: Status; owner: string | null; priority: Priority }
export interface ChatMessage {
  id: number;
  ts: number;
  author: string;  // 'user' is the owner
  to: string | null;  // who it is for; null: everyone
  body: string;  // Markdown
  tickets: ChatTicket[];
  token: string | null;
}

export interface AccessToken {
  id: number;
  name: string;
  prefix: string;
  project: string;
  can_create: boolean;
  can_edit: boolean;
  can_move: boolean;
  can_comment: boolean;
  owner_only: string | null;
  expires_at: string | null;
  last_used_at: string | null;
  last_used_ip: string | null;
  last_author: string | null;
  created_at: string | null;
}

export interface CreatedToken extends AccessToken { token: string; base_url: string; guide_url: string }

export interface TicketFields {
  title: string;
  scope: string;
  acceptance: string;
  priority: Priority;
  owner: string;
  labels: string[];
  depends_on: string[];
  resources: string[];
}

const BASE = '/api/tracker';

export function errorText(e: unknown, fallback = 'Something went wrong'): string {
  const detail = (e as { response?: { data?: { detail?: unknown } } })?.response?.data?.detail;
  return typeof detail === 'string' ? detail : fallback;
}

/** A draft's Idempotency-Key; without one, the request gets a fresh key (lib/http.ts). */
const keyed = (draftKey?: string) => (draftKey ? { headers: { 'Idempotency-Key': draftKey } } : undefined);

export const trackerApi = {
  projects: async () => (await http.get<{ projects: Project[] }>(`${BASE}/projects`)).data.projects,
  createProject: async (key: string, name: string, description = '') =>
    (await http.post(`${BASE}/projects`, { key, name, description })).data,
  tickets: async (project: string) =>
    (await http.get<{ tickets: TicketSummary[] }>(`${BASE}/projects/${project}/tickets`)).data.tickets,
  ticket: async (key: string) => (await http.get<Ticket>(`${BASE}/tickets/${key}`)).data,
  createTicket: async (project: string, fields: TicketFields) =>
    (await http.post<Ticket>(`${BASE}/projects/${project}/tickets`, fields)).data,
  updateTicket: async (key: string, fields: Partial<TicketFields> & { rank?: number }) =>
    (await http.patch<Ticket>(`${BASE}/tickets/${key}`, fields)).data,
  move: async (key: string, status: Status, note = '', rank?: number, draftKey?: string) =>
    (await http.post<Ticket>(`${BASE}/tickets/${key}/move`, { status, note, rank }, keyed(draftKey))).data,
  comment: async (key: string, body: string, files: File[], draftKey?: string) => {
    const form = new FormData();
    form.set('kind', 'comment');
    form.set('body', body);
    files.forEach((f) => form.append('files', f));
    return (await http.post<Ticket>(`${BASE}/tickets/${key}/events`, form, keyed(draftKey))).data;
  },
  resources: async (project: string) =>
    (await http.get<{ resources: Resource[] }>(`${BASE}/projects/${project}/resources`)).data.resources,
  createResource: async (project: string, body: { key: string; name: string; description: string }) =>
    (await http.post<Resource>(`${BASE}/projects/${project}/resources`, body)).data,
  updateResource: async (project: string, key: string, body: { name?: string; description?: string }) =>
    (await http.patch<Resource>(`${BASE}/projects/${project}/resources/${key}`, body)).data,
  deleteResource: async (project: string, key: string) => { await http.delete(`${BASE}/projects/${project}/resources/${key}`); },
  agents: async (project: string) => (await http.get<AgentsOverview>(`${BASE}/projects/${project}/agents`)).data,
  waitingOnYou: async (project: string) => (await http.get<WaitingOnYou>(`${BASE}/projects/${project}/waiting-on-you`)).data,
  chat: async (project: string, params: { since?: number; before?: number; limit?: number } = {}) =>
    (await http.get<{ messages: ChatMessage[]; more_before: boolean }>(`${BASE}/projects/${project}/chat`, { params })).data,
  postChat: async (project: string, body: string, to?: string | null, draftKey?: string) =>
    (await http.post<ChatMessage>(`${BASE}/projects/${project}/chat`, { body, to: to || undefined }, keyed(draftKey))).data,
  chatUnread: async (project: string) =>
    (await http.get<{ count: number; upto: number | null }>(`${BASE}/projects/${project}/chat/unread`)).data,
  chatRead: async (project: string, upto?: number) =>
    (await http.post<{ upto: number; unread: number }>(`${BASE}/projects/${project}/chat/read`, { upto })).data,
  questions: async (project: string, params: { status?: string; ticket?: string } = {}) =>
    (await http.get<{ questions: Question[]; open: number; answered: number }>(`${BASE}/projects/${project}/questions`, { params })).data,
  question: async (id: number) => (await http.get<Question>(`${BASE}/questions/${id}`)).data,
  replyQuestion: async (id: number, body: string, choice: string | null, draftKey?: string) =>
    (await http.post<Question>(`${BASE}/questions/${id}/replies`, { body, choice: choice || undefined }, keyed(draftKey))).data,
  resolveQuestion: async (id: number) => (await http.post<Question>(`${BASE}/questions/${id}/resolve`, {})).data,
  tokens: async (project: string) =>
    (await http.get<{ tokens: AccessToken[] }>(`${BASE}/projects/${project}/tokens`)).data.tokens,
  createToken: async (project: string, body: {
    name: string; can_create: boolean; can_edit: boolean; can_move: boolean; can_comment: boolean;
    owner_only: string | null; expires_in_days: number | null;
  }) => (await http.post<CreatedToken>(`${BASE}/projects/${project}/tokens`, body)).data,
  revokeToken: async (id: number) => { await http.delete(`${BASE}/tokens/${id}`); },
  /** The projects the owner shows at once (every tab and device follows it); empty until first chosen */
  view: async () => (await http.get<{ projects: string[] }>(`${BASE}/view`)).data.projects,
  saveView: async (projects: string[]) => (await http.put<{ projects: string[] }>(`${BASE}/view`, { projects })).data.projects,
};

export function clockTime(unixSeconds: number): string {
  const d = new Date(unixSeconds * 1000);
  const today = new Date();
  const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  return d.toDateString() === today.toDateString() ? time : `${d.toLocaleDateString([], { month: 'short', day: 'numeric' })} ${time}`;
}

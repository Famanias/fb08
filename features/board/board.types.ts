export type BoardUser = {
  id: string;
  username: string;
};

export type BoardThreadSummary = {
  id: string;
  title: string;
  reply_count: number;
  created_at: string;
  bumped_at: string;
  op_anon_tag?: string;
  op_display_name?: string | null;
  op_preview?: string;
  is_mine?: boolean;
};

export type BoardPostEdit = {
  id: string;
  post_id: string;
  previous_message: string;
  edited_at: string;
};

export type BoardPost = {
  id: string;
  thread_id: string;
  post_number: number;
  anon_tag: string;
  display_name?: string | null;
  parent_post_id?: string | null;
  reply_to_post_id?: string | null;
  message: string;
  created_at: string;
  edited_at: string | null;
  deleted_at: string | null;
  edits?: BoardPostEdit[];
  is_mine?: boolean;
};

export type BoardPostChatType = 'op' | 'comment' | 'reply';

export type BoardPostThreadGroup = {
  comment: BoardPost;
  replies: BoardPost[];
};

export type BoardConnectionStatus =
  | 'connecting'
  | 'live'
  | 'reconnecting'
  | 'offline'
  | 'error';

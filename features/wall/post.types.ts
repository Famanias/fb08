export type WallPost = {
  id: string;
  author: string;
  message: string;
  created_at: string; // ISO 8601, Supabase timestamptz-compatible
};

export type NewWallPost = Pick<WallPost, 'author' | 'message'>;

export type WallConnectionStatus =
  | 'preview'
  | 'connecting'
  | 'live'
  | 'reconnecting'
  | 'offline'
  | 'error';

export interface PostService {
  listLatest(limit?: number): Promise<WallPost[]>;
  create(input: NewWallPost): Promise<WallPost>;
  subscribeToNewPosts(
    onInsert: (post: WallPost) => void,
    onStatus?: (status: WallConnectionStatus) => void
  ): () => void;
}

export type WallTab = 'wall' | 'info' | 'photos' | 'notes' | 'boxes';

export type DemoComment = {
  author: string;
  text: string;
};

export type DemoInteractionsState = {
  likesByPostId: Record<string, number>;
  likedPostIds: string[];
  commentsByPostId: Record<string, DemoComment[]>;
};

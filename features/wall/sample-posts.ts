import { DemoInteractionsState, WallPost } from './post.types';

/**
 * Deterministic sample posts for Stage 1 local preview only.
 * Never ship or display these as live Supabase rows in Stage 2.
 */
export function createSamplePosts(seedNowMs: number = Date.now()): WallPost[] {
  return [
    {
      id: 'sample-1',
      author: 'Amy Chen',
      message:
        'Does anyone else remember customizing their profile and picking a favorite song? I miss the old internet. 💙',
      created_at: new Date(seedNowMs - 13 * 60 * 1000).toISOString(),
    },
    {
      id: 'sample-2',
      author: 'Jordan Bailey',
      message:
        'Found this page by accident. It feels like opening a time capsule. Who wants to be my top friend? 😄',
      created_at: new Date(seedNowMs - 71 * 60 * 1000).toISOString(),
    },
    {
      id: 'sample-3',
      author: 'Elliot Moore',
      message:
        'Currently listening to music on Winamp and pretending it’s 2008. Some things never get old.',
      created_at: new Date(seedNowMs - 7 * 60 * 60 * 1000).toISOString(),
    },
    {
      id: 'sample-4',
      author: 'Taylor Reed',
      message:
        'First post on the Wall! Leave a note for the next person who finds this place.',
      created_at: new Date(seedNowMs - 28 * 60 * 60 * 1000).toISOString(),
    },
  ];
}

export function createInitialDemoInteractions(): DemoInteractionsState {
  return {
    likesByPostId: {
      'sample-1': 8,
      'sample-2': 5,
      'sample-3': 13,
      'sample-4': 3,
    },
    likedPostIds: [],
    commentsByPostId: {
      'sample-1': [{ author: 'Jordan Bailey', text: 'The profile songs!! Absolute classics.' }],
      'sample-3': [{ author: 'Taylor Reed', text: 'The visualizer was everything.' }],
    },
  };
}

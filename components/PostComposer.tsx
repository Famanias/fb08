'use client';

import {
  FormEvent,
  KeyboardEvent,
  RefObject,
  useState,
} from 'react';
import { Lock, Smile } from 'lucide-react';
import {
  MAX_NAME_LENGTH,
  MAX_POST_LENGTH,
  appendFeeling,
  validatePostMessage,
} from '@/features/wall/wall-rules';

interface PostComposerProps {
  displayName: string;
  isPosting: boolean;
  errorMessage: string | null;
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  onCreatePost: (message: string) => Promise<boolean>;
  onUpdateDisplayName: (nextName: string) => {
    ok: boolean;
    name?: string;
    error?: string;
  };
  onClearError: () => void;
  onNotify: (message: string) => void;
}

export function PostComposer({
  displayName,
  isPosting,
  errorMessage,
  textareaRef,
  onCreatePost,
  onUpdateDisplayName,
  onClearError,
  onNotify,
}: PostComposerProps) {
  const [message, setMessage] = useState('');
  const [editingName, setEditingName] = useState(false);
  const [draftName, setDraftName] = useState(displayName);

  const count = message.length;
  const remaining = MAX_POST_LENGTH - count;
  const validation = validatePostMessage(message);

  async function submitPost() {
    if (!validation.valid || isPosting) {
      if (!validation.valid && message.length > MAX_POST_LENGTH) {
        onNotify(`Please write a message under ${MAX_POST_LENGTH} characters.`);
      }
      return;
    }

    const ok = await onCreatePost(message);
    if (ok) {
      setMessage('');
      onNotify('Posted to the Wall!');
    }
  }

  function handleFormSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    void submitPost();
  }

  function handleTextareaKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      void submitPost();
    }
  }

  function handleSaveName() {
    const result = onUpdateDisplayName(draftName);
    if (!result.ok) {
      onNotify(result.error ?? 'Please enter a display name.');
      return;
    }
    setEditingName(false);
    if (result.error) {
      onNotify(result.error);
    } else {
      onNotify(`You are now posting as ${result.name}`);
    }
  }

  function handleFeelingClick() {
    const { next, added } = appendFeeling(message, ':)');
    if (added) {
      setMessage(next);
      textareaRef.current?.focus();
    } else {
      onNotify(`Character limit of ${MAX_POST_LENGTH} reached.`);
    }
  }

  return (
    <>
      <div className="name-pop">
        Posting as <strong id="name-preview">{displayName}</strong> &nbsp;·&nbsp;{' '}
        <button
          type="button"
          className="subtle-action"
          id="edit-name"
          aria-expanded={editingName}
          onClick={() => {
            setDraftName(displayName);
            setEditingName((prev) => !prev);
          }}
        >
          Change display name
        </button>
        {editingName ? (
          <div id="name-controls" className="name-controls">
            <input
              className="user-input"
              id="nickname"
              type="text"
              maxLength={MAX_NAME_LENGTH}
              aria-label="Display name"
              placeholder={`Your name (up to ${MAX_NAME_LENGTH} characters)`}
              value={draftName}
              onChange={(e) => setDraftName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  handleSaveName();
                }
              }}
              autoFocus
            />
            <button
              type="button"
              className="small-btn"
              id="save-name"
              onClick={handleSaveName}
            >
              Save
            </button>
          </div>
        ) : null}
      </div>

      <form className="composer" id="composer-form" onSubmit={handleFormSubmit}>
        <textarea
          ref={textareaRef}
          id="message"
          maxLength={MAX_POST_LENGTH}
          aria-label="Write a wall post"
          placeholder="What's on your mind?"
          value={message}
          onChange={(e) => {
            setMessage(e.target.value);
            if (errorMessage) {
              onClearError();
            }
          }}
          onKeyDown={handleTextareaKeyDown}
          disabled={isPosting}
          required
        />
        <div className="composer-tools">
          <div className="tool-left">
            <span>Attach:</span>
            <button
              className="tool-chip"
              id="mood-button"
              title="Insert a smiley"
              type="button"
              onClick={handleFeelingClick}
              disabled={isPosting}
            >
              <Smile className="svg-icon" aria-hidden="true" /> Feeling
            </button>
            <span style={{ color: '#bec5d0' }}>|</span>
            <span style={{ color: '#8995a5' }}>Text update</span>
          </div>
          <div className="tool-right">
            <span className="privacy">
              <Lock className="svg-icon" aria-hidden="true" /> Everyone
            </span>
            <span
              className={`counter${count >= 250 ? ' low' : ''}${
                count > MAX_POST_LENGTH ? ' over' : ''
              }`}
              id="counter"
              aria-live="polite"
            >
              {remaining} left
            </span>
            <button
              className="btn-share"
              id="share"
              type="submit"
              disabled={!validation.valid || isPosting}
            >
              {isPosting ? 'Sharing...' : 'Share'}
            </button>
          </div>
        </div>
        {errorMessage ? (
          <div className="inline-alert" role="alert">
            <span>{errorMessage}</span>
            <button
              type="button"
              className="small-btn"
              onClick={onClearError}
            >
              Dismiss
            </button>
          </div>
        ) : null}
      </form>
    </>
  );
}

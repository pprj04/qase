import { useEffect, useMemo, useRef, useState } from 'react';
import { useLiveSession, isCredentialQuestion } from '../state/liveSession';
import { useToast } from '../state/toastStore';
import { renderMarkdown, tailOf } from '../lib/markdown';
import type { SessionMessage } from '../api/sse';

const ROLE_LABELS: Record<string, string> = { agent: 'Qase', user: 'You', system: 'System' };

/**
 * Transcript — chat bubbles (agent bodies render markdown; user/system plain),
 * streaming deltas appended live, thinking strip while running, question slot,
 * composer with Enter-to-send / Shift+Enter newline.
 */
export function Transcript() {
  const { session, sendMessage, sendAnswer, storeCredentials, stopRun } = useLiveSession();
  const { toast } = useToast();
  const scrollRef = useRef<HTMLDivElement>(null);
  const [followBottom, setFollowBottom] = useState(true);
  const [draft, setDraft] = useState('');

  const messages = session?.messages ?? [];
  const running = session?.status === 'running';

  // Auto-scroll only when the user is already near the bottom (legacy 160px rule).
  useEffect(() => {
    if (!followBottom) return;
    const node = scrollRef.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [messages, session?.deltas, session?.thinkingText, followBottom]);

  const onScroll = () => {
    const node = scrollRef.current;
    if (!node) return;
    setFollowBottom(node.scrollHeight - node.scrollTop - node.clientHeight < 160);
  };

  const submit = (event?: React.FormEvent) => {
    event?.preventDefault();
    const text = draft.trim();
    if (!text) return;
    setDraft('');
    void sendMessage(text).catch((error) => toast(error instanceof Error ? error.message : String(error), 'bad'));
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      submit();
    }
  };

  // Auto-grow: match content height up to the 170px cap (legacy rule).
  const autoGrow = (node: HTMLTextAreaElement | null) => {
    if (!node) return;
    node.style.height = 'auto';
    node.style.height = `${Math.min(node.scrollHeight, 170)}px`;
  };

  if (!session) {
    return (
      <div className="conversation-empty" data-testid="conversation-empty">
        <div className="conversation-empty-logo" aria-hidden="true">Q</div>
        <h1>What should I test today?</h1>
        <p>Describe a site or a flow and QASE will drive a real browser, watch for bugs, and report back with evidence.</p>
      </div>
    );
  }

  return (
    <div className="conversation-live">
      <div className="transcript" ref={scrollRef} onScroll={onScroll} data-testid="transcript">
        {messages.length === 0 && Object.keys(session.deltas).length === 0 && !running && (
          <div className="msg msg--agent">
            <span className="msg-role">Qase</span>
            <div className="msg-body md" data-testid="transcript-greeting">
              Send a URL or describe what to test.
            </div>
          </div>
        )}
        {messages.map((message) => (
          <MessageBubble key={message.id} message={message} />
        ))}
        {Object.entries(session.deltas).map(([id, text]) => (
          <div key={`delta-${id}`} className="msg msg--agent">
            <span className="msg-role">Qase</span>
            <div className="msg-body md" dangerouslySetInnerHTML={{ __html: renderMarkdown(text) }} />
          </div>
        ))}
        {running && <ThinkingStrip />}
        {session.pendingQuestion && (
          <QuestionSlot
            question={session.pendingQuestion}
            credential={isCredentialQuestion(session.pendingQuestion)}
            onAnswer={(answer) => void sendAnswer(answer)}
            onStoreCredentials={(fields) =>
              storeCredentials(fields)
                .then(() => toast('Credentials stored locally. The model only sees placeholders.', 'good'))
                .catch((error) => toast(error instanceof Error ? error.message : String(error), 'bad'))
            }
          />
        )}
      </div>
      <form className="composer" onSubmit={submit} data-testid="composer">
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKeyDown}
          ref={(node) => {
            if (node) autoGrow(node);
          }}
          placeholder={running ? 'Qase is testing — type to add guidance…' : 'Describe what to test, or paste a URL…'}
          rows={1}
          aria-label="Message Qase"
          data-testid="composer-input"
        />
        <div className="composer-actions">
          {running && (
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => void stopRun()} data-testid="stop-run">
              Stop
            </button>
          )}
          <button type="submit" className="btn btn-primary btn-sm" disabled={!draft.trim()} data-testid="composer-send">
            Send
          </button>
        </div>
      </form>
    </div>
  );
}

function MessageBubble({ message }: { message: SessionMessage }) {
  const role = message.role in ROLE_LABELS ? message.role : message.role;
  return (
    <div className={`msg msg--${role}`} data-message-id={message.id}>
      <span className="msg-role">{ROLE_LABELS[role] ?? role}</span>
      {role === 'agent' ? (
        <div className="msg-body md" dangerouslySetInnerHTML={{ __html: renderMarkdown(String((message.text as string | undefined) ?? (message.content as string | undefined) ?? '')) }} />
      ) : (
        <div className="msg-body">{String((message.text as string | undefined) ?? (message.content as string | undefined) ?? '')}</div>
      )}
    </div>
  );
}

function ThinkingStrip() {
  const { session } = useLiveSession();
  const [open, setOpen] = useState(false);
  const bodyRef = useRef<HTMLDivElement>(null);
  const hasDetail = Boolean(session?.thinkingText);

  useEffect(() => {
    if (open && bodyRef.current) bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
  }, [session?.thinkingText, open]);

  const peek = useMemo(() => {
    const text = session?.thinkingText ?? '';
    return text ? tailOf(text) : (session?.thinkingAction ?? '');
  }, [session?.thinkingText, session?.thinkingAction]);

  return (
    <div className={`thinking-strip${hasDetail ? ' has-detail' : ''}${open ? ' is-open' : ''}`} data-testid="thinking-strip">
      <button
        type="button"
        className="thinking-head"
        aria-expanded={open && hasDetail}
        onClick={() => hasDetail && setOpen((v) => !v)}
      >
        <span className="thinking-label" data-testid="thinking-label">{hasDetail ? 'Thinking' : 'Working'}</span>
        <span className="thinking-peek">{peek}</span>
        {hasDetail && <span className="thinking-caret" aria-hidden="true">{open ? '▾' : '▸'}</span>}
      </button>
      {hasDetail && open && (
        <div className="thinking-body" ref={bodyRef} data-testid="thinking-body">
          {session?.thinkingText}
        </div>
      )}
    </div>
  );
}

function QuestionSlot({
  question,
  credential,
  onAnswer,
  onStoreCredentials,
}: {
  question: { question: string; summary?: string; options?: { label: string; description?: string }[]; allowCustom?: boolean; customPlaceholder?: string; customLabel?: string; usernameLabel?: string; passwordLabel?: string; otpLabel?: string };
  credential: boolean;
  onAnswer: (answer: string) => void;
  onStoreCredentials: (fields: Record<string, string>) => void;
}) {
  const { toast } = useToast();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [otp, setOtp] = useState('');
  const [custom, setCustom] = useState('');
  const firstInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    firstInputRef.current?.focus();
  }, []);

  const storeAndContinue = () => {
    const fields: Record<string, string> = {};
    if (username) fields.QA_USERNAME = username;
    if (password) fields.QA_PASSWORD = password;
    if (otp) fields.QA_OTP = otp;
    if (Object.keys(fields).length === 0) {
      toast('Enter a username or password first.', 'bad');
      return;
    }
    // Values go to the run vault (encrypted, per-run, keyboard-swapped) —
    // never into the model's context. Legacy parity.
    onStoreCredentials(fields);
  };

  return (
    <div className="question-card" data-testid="question-card">
      <span className={`question-tag${credential ? ' is-credential' : ''}`}>
        {credential ? 'Credentials needed' : 'Decision needed'}
      </span>
      <p className="question-text">{question.question}</p>
      {question.summary && <p className="question-summary">{question.summary}</p>}
      {credential ? (
        <div className="question-form">
          <label className="field">
            <span>{question.usernameLabel ?? 'Username'}</span>
            <input ref={firstInputRef} value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="off" />
          </label>
          <label className="field">
            <span>{question.passwordLabel ?? 'Password'}</span>
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="off" />
          </label>
          <label className="field">
            <span>{question.otpLabel ?? 'One-time code or extra field (optional)'}</span>
            <input value={otp} onChange={(e) => setOtp(e.target.value)} autoComplete="off" />
          </label>
          <p className="question-note">
            Encrypted locally for this run and deleted when the run ends — never sent to the model. The agent fills
            the form with <code>{'{{QA_USERNAME}}'}</code> and <code>{'{{QA_PASSWORD}}'}</code>; the real values are
            swapped in at the keyboard.
          </p>
          <div className="question-actions">
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => onAnswer('Continue with a public-only review. No credentials are available. Treat authenticated surfaces as not observed, do not attempt login, and do not ask for credentials again during this review.')}>
              Skip login
            </button>
            <button type="button" className="btn btn-primary btn-sm" onClick={storeAndContinue}>
              Store and continue
            </button>
          </div>
        </div>
      ) : (
        <div className="question-form">
          {(question.options ?? []).map((option) => (
            <button
              key={option.label}
              type="button"
              className="question-option"
              onClick={() => onAnswer(option.label)}
            >
              <span>{option.label}</span>
              {option.description && <small>{option.description}</small>}
            </button>
          ))}
          {question.allowCustom && (
            <form
              className="question-custom"
              onSubmit={(e) => {
                e.preventDefault();
                if (custom.trim()) onAnswer(custom.trim());
              }}
            >
              <input
                ref={firstInputRef}
                value={custom}
                onChange={(e) => setCustom(e.target.value)}
                placeholder={question.customPlaceholder ?? 'Type your own answer'}
              />
              <button type="submit" className="btn btn-primary btn-sm">{question.customLabel ?? 'Reply'}</button>
            </form>
          )}
        </div>
      )}
    </div>
  );
}

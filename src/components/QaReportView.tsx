import { useEffect, useMemo, useState } from 'react';
import { api, apiResponse, apiText } from '../api/client';
import type { LiveSession } from '../state/liveSession';
import { useToast } from '../state/toastStore';
import { buildAllFixPromptsMarkdown } from '../lib/fixPromptBuilder';
import { buildFollowUpMessage, followUpSuggestions } from '../lib/followUp';
import { DrytisBoardPanel } from './DrytisBoardPanel';

const VERDICTS: Readonly<Record<string, { mark: string; label: string; tone: string }>> = {
	pass: { mark: '✓', label: 'Pass', tone: 'ok' },
	pass_with_issues: { mark: '!', label: 'Pass with issues', tone: 'warn' },
	fail: { mark: '✕', label: 'Fail', tone: 'bad' },
	blocked: { mark: '—', label: 'Blocked', tone: 'dim' },
};

const SEVERITY_ORDER: readonly string[] = ['critical', 'high', 'medium', 'low', 'info'];

interface QaReport {
	verdict?: string;
	findings?: number;
	ts?: number;
	summary?: string;
	covered?: string[];
	notCovered?: string[];
	recommendations?: string[];
	bySeverity?: Record<string, number>;
}

interface FeedbackRecord {
	rating: number;
	comments?: string;
	submittedAt?: number;
}

function exportError(error: unknown, fallback: string, toast: (message: string, kind?: 'good' | 'bad') => void) {
	const err = error as Error & { status?: number };
	if (err?.status === 409) {
		toast('The report is still being finalized — try again once the run completes.', 'bad');
		return;
	}
	toast(err?.message || fallback, 'bad');
}

async function downloadBlob(blob: Blob, filename: string) {
	const url = URL.createObjectURL(blob);
	const save = document.createElement('a');
	save.href = url;
	save.download = filename;
	document.body.append(save);
	save.click();
	save.remove();
	window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
	return (
		<section className="report-section">
			<h3>{title}</h3>
			{children}
		</section>
	);
}

function ListBlock({ items }: { items: string[] }) {
	return (
		<ul className="report-list">
			{items.map((item, index) => <li key={index}>{item}</li>)}
		</ul>
	);
}

function FollowUps({ targetUrl, suggestions, currentSession }: { targetUrl: string; suggestions: string[]; currentSession: LiveSession & { device?: string; deviceLandscape?: boolean; engine?: string } }) {
	const { toast } = useToast();
	const [selected, setSelected] = useState<Set<string>>(() => new Set(suggestions));
	const [running, setRunning] = useState(false);

	const allChecked = suggestions.length > 0 && suggestions.every((item) => selected.has(item));
	const someChecked = suggestions.some((item) => selected.has(item));

	const runFollowUps = async () => {
		const chosen = suggestions.filter((item) => selected.has(item));
		const message = buildFollowUpMessage(targetUrl, chosen);
		if (!message) {
			toast('Check at least one item to run a follow-up.', 'bad');
			return;
		}
		setRunning(true);
		try {
			// Legacy createQaRun parity: carry the originating run's device,
			// orientation and engine into the follow-up so a mobile/WebKit run
			// produces a mobile/WebKit follow-up.
			const session = await api<{ id: string }>('/sessions', {
				method: 'POST',
				body: JSON.stringify({
					device: currentSession.device,
					deviceLandscape: currentSession.deviceLandscape === true,
					engine: currentSession.engine,
				}),
			});
			await api(`/sessions/${session.id}/message`, { method: 'POST', body: JSON.stringify({ text: message }) });
			toast('Follow-up run started.', 'good');
		} catch (error) {
			toast((error as Error).message || 'The follow-up could not start.', 'bad');
		} finally {
			setRunning(false);
		}
	};

	return (
		<section className="follow-ups" aria-label="Suggested follow-up tests">
			<div className="follow-ups-head">
				<strong>Test these next</strong>
				<small>Left untested or recommended by this run — start a focused follow-up</small>
				<label className="check follow-ups-all">
					<input
						type="checkbox"
						checked={allChecked}
						ref={(node) => {
							if (node) node.indeterminate = !allChecked && someChecked;
						}}
						onChange={() => setSelected(allChecked ? new Set() : new Set(suggestions))}
					/>
					<span>Select all</span>
				</label>
			</div>
			<div className="follow-ups-list">
				{suggestions.map((suggestion) => (
					<label key={suggestion} className="check">
						<input
							type="checkbox"
							checked={selected.has(suggestion)}
							onChange={() => setSelected((previous) => {
								const next = new Set(previous);
								if (next.has(suggestion)) next.delete(suggestion);
								else next.add(suggestion);
								return next;
							})}
						/>
						<span>{suggestion}</span>
					</label>
				))}
			</div>
			<button type="button" className="btn btn-primary btn-sm" disabled={running} onClick={() => void runFollowUps()}>
				{running ? 'Starting…' : 'Run selected follow-ups'}
			</button>
		</section>
	);
}

function RunFeedback({ session }: { session: LiveSession }) {
	const { toast } = useToast();
	const [rating, setRating] = useState<string | undefined>(undefined);
	const current = rating ?? (session as unknown as { feedback?: { rating?: string } }).feedback?.rating;

	const vote = async (value: 'up' | 'down') => {
		try {
			const result = await api<{ feedback?: { rating: string } }>(`/sessions/${session.id}/feedback`, {
				method: 'POST',
				body: JSON.stringify({ rating: value }),
			});
			setRating(result?.feedback?.rating ?? value);
			toast('Thanks for the feedback.', 'good');
		} catch (error) {
			toast((error as Error).message || 'The feedback could not be saved.', 'bad');
		}
	};

	return (
		<div className="run-feedback">
			<span className="run-feedback-label">How was this run?</span>
			{(['up', 'down'] as const).map((value) => (
				<button
					key={value}
					type="button"
					className={`btn btn-ghost btn-sm run-feedback-btn is-${value}${current === value ? ' is-selected' : ''}`}
					aria-pressed={current === value}
					title={value === 'up' ? 'This run was useful' : 'This run missed the mark'}
					onClick={() => void vote(value)}
				>
					{value === 'up' ? '👍' : '👎'}
				</button>
			))}
			{current ? <span className="run-feedback-thanks">Thanks — noted.</span> : null}
		</div>
	);
}

export function QaReportView({ session }: { session: LiveSession & { feedback?: { rating?: string } } }) {
	const { toast } = useToast();
	const [detailedFeedback, setDetailedFeedback] = useState<FeedbackRecord | null | undefined>(undefined);
	const report = session.report as QaReport | undefined;
	const suggestions = useMemo(() => (session.targetUrl ? followUpSuggestions(report) : []), [report, session.targetUrl]);

	// Fetch the submitter's detailed feedback record for this run once.
	useEffect(() => {
		let cancelled = false;
		setDetailedFeedback(undefined);
		api<FeedbackRecord | null>(`/sessions/${session.id}/feedback`)
			.then((record) => { if (!cancelled) setDetailedFeedback(record ?? null); })
			.catch(() => { if (!cancelled) setDetailedFeedback(null); });
		return () => { cancelled = true; };
	}, [session.id]);

	const finished = session.status === 'done' || session.status === 'error';

	const downloadMarkdown = async () => {
		try {
			const markdownText = await apiText(`/sessions/${session.id}/report.md`);
			await downloadBlob(new Blob([markdownText], { type: 'text/markdown;charset=utf-8' }), 'qase-report.md');
		} catch (error) {
			exportError(error, 'The report download failed.', toast);
		}
	};

	const copyReport = async () => {
		try {
			const markdownText = await apiText(`/sessions/${session.id}/report.md`);
			await navigator.clipboard.writeText(markdownText);
			toast('Report copied to the clipboard.', 'good');
		} catch (error) {
			exportError(error, 'The report copy failed.', toast);
		}
	};

	const downloadPdf = async () => {
		try {
			const response = await apiResponse(`/sessions/${session.id}/report.pdf`);
			await downloadBlob(await response.blob(), 'qase-qa-report.pdf');
		} catch (error) {
			exportError(error, 'The PDF export failed.', toast);
		}
	};

	const copyFixPrompts = async () => {
		const markdown = buildAllFixPromptsMarkdown(session as never);
		if (!markdown) {
			toast('No findings to build fix prompts from.', 'bad');
			return;
		}
		try {
			await navigator.clipboard.writeText(markdown);
			toast('All fix prompts copied.', 'good');
		} catch {
			toast('Clipboard is blocked in this browser.', 'bad');
		}
	};

	const downloadFixPrompts = async () => {
		const markdown = buildAllFixPromptsMarkdown(session as never);
		if (!markdown) {
			toast('No findings to build fix prompts from.', 'bad');
			return;
		}
		await downloadBlob(new Blob([markdown], { type: 'text/markdown;charset=utf-8' }), 'qase-fix-prompts.md');
	};

	if (!report) {
		return <div className="feed-empty">The report is published when the run finishes</div>;
	}

	const verdict = VERDICTS[report.verdict ?? ''] ?? { mark: '•', label: report.verdict ?? 'Unknown', tone: 'dim' };
	const findings = session.findings ?? [];

	return (
		<div className="qa-report-view">
			<div className="verdict">
				<span className={`verdict-mark is-${verdict.tone}`}>{verdict.mark}</span>
				<div>
					<div className="verdict-label">{verdict.label}</div>
					<div className="verdict-sub">
						{report.findings} finding{report.findings === 1 ? '' : 's'} · {new Date(report.ts ?? Date.now()).toLocaleString()}
					</div>
				</div>
			</div>

			<div className="sev-grid">
				{SEVERITY_ORDER.map((severity) => {
					const count = report.bySeverity?.[severity] ?? 0;
					return (
						<div key={severity} className={`sev-stat${count === 0 ? ' is-zero' : ''}`}>
							<b>{count}</b>
							<span>{severity}</span>
						</div>
					);
				})}
			</div>

			{report.summary ? <Section title="Summary"><p>{report.summary}</p></Section> : null}
			{report.covered?.length ? <Section title="Covered"><ListBlock items={report.covered} /></Section> : null}
			{report.notCovered?.length ? <Section title="Not covered"><ListBlock items={report.notCovered} /></Section> : null}
			{report.recommendations?.length ? <Section title="Recommendations"><ListBlock items={report.recommendations} /></Section> : null}

			{suggestions.length > 0 && session.targetUrl ? (
				<FollowUps targetUrl={session.targetUrl} suggestions={suggestions} currentSession={session} />
			) : null}

			<div className="report-actions" role="group" aria-label="Report actions">
				<button type="button" className="btn btn-ghost btn-sm" onClick={() => void downloadMarkdown()}>Download .md</button>
				<button type="button" className="btn btn-ghost btn-sm" onClick={() => void copyReport()}>Copy report</button>
				<button
					type="button"
					className="btn btn-ghost btn-sm"
					disabled={findings.length === 0}
					title={findings.length === 0 ? 'No findings to generate fix prompts for.' : 'Copies one long markdown block containing a fix prompt for every finding.'}
					onClick={() => void copyFixPrompts()}
				>
					Copy all fix prompts
				</button>
				<button type="button" className="btn btn-ghost btn-sm" disabled={findings.length === 0} onClick={() => void downloadFixPrompts()}>
					Download fix prompts (.md)
				</button>
				<button type="button" className="btn btn-primary btn-sm" onClick={() => void downloadPdf()}>Download PDF</button>
			</div>

			{finished ? <RunFeedback session={session} /> : null}

			{detailedFeedback ? (
				<section className="report-feedback" aria-label="User feedback">
					<h3 className="report-feedback-title">USER FEEDBACK</h3>
					<div className="report-feedback-stars">
						{'★'.repeat(detailedFeedback.rating)}{'☆'.repeat(5 - detailedFeedback.rating)}
						<span className="report-feedback-score"> {detailedFeedback.rating}/5</span>
					</div>
					<p className="report-feedback-description">
						{detailedFeedback.comments?.trim() ? detailedFeedback.comments : 'No description provided.'}
					</p>
					{detailedFeedback.submittedAt ? (
						<p className="report-feedback-meta">Submitted By: You · Submitted On: {new Date(detailedFeedback.submittedAt).toLocaleString()}</p>
					) : null}
				</section>
			) : null}

			<section className="files-section" aria-label="Files">
				<h3 className="files-title">FILES</h3>
				<div className="file-row">
					<span className="file-icon" aria-hidden="true">🗎</span>
					<div className="file-info">
						<span className="file-name">QA report (PDF)</span>
						<span className="file-desc">Full test report as a printable PDF.</span>
					</div>
					<button type="button" className="btn btn-ghost btn-sm" onClick={() => void downloadPdf()}>Download</button>
				</div>
				<div className="file-row">
					<span className="file-icon" aria-hidden="true">▤</span>
					<div className="file-info">
						<span className="file-name">QA report (Markdown)</span>
						<span className="file-desc">Plain-text report for notes and diffs.</span>
					</div>
					<button type="button" className="btn btn-ghost btn-sm" onClick={() => void downloadMarkdown()}>Download</button>
				</div>
				<div className="file-row">
					<span className="file-icon" aria-hidden="true">🛠</span>
					<div className="file-info">
						<span className="file-name">Fix prompts (Markdown)</span>
						<span className="file-desc">One fix prompt per finding for your engineers.</span>
					</div>
					<button
						type="button"
						className="btn btn-ghost btn-sm"
						disabled={findings.length === 0}
						title={findings.length === 0 ? 'No findings to generate fix prompts for.' : undefined}
						onClick={() => void downloadFixPrompts()}
					>
						Download
					</button>
				</div>
			</section>
			<DrytisBoardPanel session={session} />
		</div>
	);
}

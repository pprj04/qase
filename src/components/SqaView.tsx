import type { ReactNode } from 'react';
import {
	SQA_RESULT_META,
	describeSqaLifecycle,
	groupSqaUnresolvedResults,
	humanizeSqaId,
	sqaValues,
	type SqaAssessment,
	type SqaControlResult,
	type SqaLifecycle,
	type SqaState,
} from '../lib/sqaPresentation';

/** Render only http(s) references as links — everything else as text. */
function SafeLink({ label, href }: { label: string; href?: string }) {
	let safeUrl: string | undefined;
	try {
		const candidate = new URL(String(href ?? ''));
		if (candidate.protocol === 'http:' || candidate.protocol === 'https:') safeUrl = candidate.href;
	} catch {
		// Render untrusted references as text rather than active links.
	}
	if (!safeUrl) return <span>{label}</span>;
	return <a href={safeUrl} target="_blank" rel="noreferrer noopener">{label}</a>;
}

function SqaSection({ title, subtitle, children }: { title: string; subtitle: string; children: ReactNode }) {
	return (
		<section className="sqa-section">
			<header>
				<h3>{title}</h3>
				<p>{subtitle}</p>
			</header>
			{children}
		</section>
	);
}

function labeledText(label: string, text: string) {
	return (
		<p key={`${label}-${text.slice(0, 24)}`}>
			<strong>{label}: </strong>
			{text}
		</p>
	);
}

function StatusLabel({ status }: { status: string }) {
	return <span className="sqa-status">{SQA_RESULT_META[status]?.label ?? humanizeSqaId(status)}</span>;
}

function SqaVerdict({ assessment, lifecycle }: { assessment: SqaAssessment | null | undefined; lifecycle: SqaLifecycle }) {
	let detail = 'Evidence collection is underway. Current control results remain provisional.';
	if (lifecycle.finalized && assessment) {
		if (lifecycle.evidenceIncomplete && lifecycle.evidenceGapCount) {
			const gaps = lifecycle.evidenceGapCount;
			detail = `Deterministic verdict: Blocked. No control failures were recorded; ${gaps} reviewer or mixed-evidence control${gaps === 1 ? '' : 's'} remain incomplete.`;
		} else {
			const gates = assessment.gates ?? [];
			const passed = gates.filter((gate) => gate.status === 'pass').length;
			const risk = assessment.risk?.level ? ` Residual risk: ${humanizeSqaId(assessment.risk.level)}.` : '';
			detail = `${passed}/${gates.length} decision gates passed.${risk}`;
		}
	} else if (lifecycle.phase === 'ready') {
		detail = 'The scope is saved. Testing has not started and no final verdict exists yet.';
	} else if (lifecycle.phase === 'waiting') {
		detail = "Answer the agent's question to continue collecting assessment evidence.";
	}

	return (
		<section className="sqa-verdict" data-status={lifecycle.status}>
			<span className="sqa-verdict-mark" aria-hidden="true">{lifecycle.mark}</span>
			<div>
				<span className="sqa-eyebrow">{lifecycle.eyebrow}</span>
				<strong>{lifecycle.label}</strong>
				<p>{detail}</p>
			</div>
			<code className="sqa-assessment-id">{lifecycle.finalized ? assessment?.assessmentId ?? 'result-unavailable' : 'draft-assessment'}</code>
		</section>
	);
}

function SqaScope({ scope, assessment }: { scope: Record<string, unknown>; assessment: SqaAssessment | null | undefined }) {
	const target = (assessment?.target ?? (scope.target as SqaAssessment['target'])) ?? {};
	const profiles = (assessment?.profiles ?? (scope.profiles as string[])) ?? [];
	const attributes = (assessment?.attributes ?? (scope.attributes as string[])) ?? [];
	const definitions: [string, string][] = [
		['Target', target.name ?? 'Not provided'],
		['Release', target.release ?? 'Not provided'],
		['Environment', target.environment ?? 'Not provided'],
		['Catalog', assessment?.catalogVersion ?? (scope.catalogVersion as string) ?? 'Current server catalog'],
		['Profiles', profiles.length ? profiles.map(humanizeSqaId).join(', ') : 'Universal core'],
		['Attributes', attributes.length ? attributes.map(humanizeSqaId).join(', ') : 'None declared'],
	];
	const notesText = (assessment?.scopeNotes ?? scope.scopeNotes) as string | undefined;
	return (
		<SqaSection title="Assessment scope" subtitle="Target, release, and declared applicability inputs.">
			<dl className="sqa-scope-grid">
				{definitions.map(([term, value]) => (
					<div key={term}>
						<dt>{term}</dt>
						<dd>{String(value)}</dd>
					</div>
				))}
			</dl>
			{notesText ? <p className="sqa-scope-notes">{notesText}</p> : null}
		</SqaSection>
	);
}

function SqaTechnicalSummary({ summary }: { summary: NonNullable<SqaAssessment['technicalSummary']> }) {
	const applicable = Number(summary?.applicableControls) || 0;
	const verdict = summary?.verdict ?? 'not_applicable';
	const meta = SQA_RESULT_META[verdict] ?? { label: humanizeSqaId(verdict), mark: '•' };
	const copy = verdict === 'pass'
		? 'All applicable browser checks completed successfully.'
		: verdict === 'fail'
			? 'At least one automated browser check produced an evidence-backed failure.'
			: verdict === 'blocked'
				? 'At least one automated browser check could not complete or lacks technical evidence.'
				: 'This assessment scope contains no automated web controls.';
	return (
		<SqaSection
			title="Automated web checks"
			subtitle={applicable ? `${applicable} controlled-browser check${applicable === 1 ? '' : 's'} evaluated separately from reviewer evidence.` : 'No automated web checks applied to this scope.'}
		>
			<div className="sqa-technical">
				<div className="sqa-technical-summary" data-status={verdict}>
					<span className="sqa-status">{meta.label}</span>
					<p>{copy}</p>
				</div>
				<dl className="sqa-technical-counts">
					{([['Passed', 'pass'], ['Failed', 'fail'], ['Blocked', 'blocked'], ['Not run', 'not_assessed']] as [string, 'pass' | 'fail' | 'blocked' | 'not_assessed'][]).map(([label, key]) => (
						<div key={label}>
							<dd>{String(Number(summary?.[key]) || 0)}</dd>
							<dt>{label}</dt>
						</div>
					))}
				</dl>
			</div>
		</SqaSection>
	);
}

function SqaMetric({ label, value }: { label: string; value: number | undefined }) {
	const numeric = Number(value);
	const percent = Number.isFinite(numeric) ? Math.max(0, Math.min(100, numeric)) : 0;
	return (
		<div className="sqa-metric">
			<div>
				<span>{label}</span>
				<strong>{Number.isFinite(numeric) ? `${numeric}%` : '—'}</strong>
			</div>
			<span className="sqa-meter">
				<i style={{ width: `${percent}%` }} />
			</span>
		</div>
	);
}

function SqaCoverage({ assessment }: { assessment: SqaAssessment }) {
	return (
		<SqaSection title="Coverage and decision gates" subtitle="Conclusive results require pass or fail; blocked and not assessed remain unresolved.">
			<div className="sqa-metric-grid">
				<SqaMetric label="Observed controls" value={assessment.coverage?.observed} />
				<SqaMetric label="Conclusive controls" value={assessment.coverage?.conclusive} />
				<SqaMetric label="Mandatory passed" value={assessment.coverage?.mandatoryPassed} />
				<SqaMetric label="Evidence satisfied" value={assessment.coverage?.evidence} />
			</div>
			<div>
				{(assessment.gates ?? []).map((gate) => (
					<div key={gate.title} className="sqa-gate" data-status={gate.status}>
						<StatusLabel status={gate.status} />
						<div>
							<strong>{gate.title}</strong>
							<p>{gate.detail ?? ''}</p>
						</div>
					</div>
				))}
			</div>
		</SqaSection>
	);
}

function SqaUnresolvedRow({ result }: { result: SqaControlResult }) {
	const missing = result.evidenceCoverage?.missing ?? [];
	const reason = result.decisionNotes?.[0] ?? result.rationale
		?? (missing.length ? `Missing evidence: ${missing.join(', ')}.` : 'A conclusive evidence-backed result is not available.');
	return (
		<div className="sqa-unresolved" data-status={result.status}>
			<StatusLabel status={result.status} />
			<div>
				<strong>{result.controlId} · {result.title}</strong>
				<p>{reason}</p>
			</div>
		</div>
	);
}

function SqaUnresolved({ assessment }: { assessment: SqaAssessment }) {
	const groups = groupSqaUnresolvedResults(assessment.results);
	const evidenceGaps = groups.reviewer.length + groups.mixed.length;
	const unresolvedCount = groups.failures.length + evidenceGaps + groups.automated.length;
	const sections: { title: string; description: string; results: SqaControlResult[]; kind: string }[] = [
		{ title: 'Confirmed failures', description: 'Evidence-backed control failures that affect the product verdict.', results: groups.failures, kind: 'failures' },
		{ title: 'Reviewer evidence required', description: 'Documents, approvals, records, or independent review must be supplied by an authorized reviewer.', results: groups.reviewer, kind: 'reviewer' },
		{ title: 'Mixed evidence incomplete', description: 'This control combines browser-observable checks with external reviewer artifacts.', results: groups.mixed, kind: 'mixed' },
		{ title: 'Automated check blocked / not run', description: 'The controlled browser check did not complete or lacks agent-capable technical evidence.', results: groups.automated, kind: 'automated' },
	];
	return (
		<SqaSection title="Failures and evidence gaps" subtitle={`${groups.failures.length} failed · ${evidenceGaps} reviewer/mixed evidence gaps · ${groups.automated.length} automated incomplete`}>
			{unresolvedCount === 0 ? (
				<p className="sqa-section-empty">No unresolved controls in this assessment.</p>
			) : (
				<div className="sqa-unresolved-groups">
					{sections.filter((group) => group.results.length > 0).map((group) => (
						<section key={group.kind} className="sqa-unresolved-group" data-kind={group.kind}>
							<h4>{group.title} ({group.results.length})</h4>
							<p className="sqa-unresolved-group-description">{group.description}</p>
							<div className="sqa-unresolved-list">
								{group.results.map((result) => <SqaUnresolvedRow key={result.controlId} result={result} />)}
							</div>
						</section>
					))}
				</div>
			)}
		</SqaSection>
	);
}

function SqaControl({ result }: { result: SqaControlResult }) {
	const evidence = sqaValues(result.evidence);
	const requirements = result.evidenceCoverage?.requirements ?? [];
	return (
		<details className="sqa-control" data-status={result.status}>
			<summary>
				<code>{result.controlId}</code>
				<span>{result.title}</span>
				<StatusLabel status={result.status} />
			</summary>
			<div className="sqa-control-body">
				<p className="sqa-control-meta">
					{humanizeSqaId(result.domain)} · {humanizeSqaId(result.severity)} severity · {humanizeSqaId(result.automationLevel)}{result.mandatory ? ' · Mandatory' : ''}
				</p>
				{result.rationale ? labeledText('Rationale', result.rationale) : null}
				{(result.decisionNotes ?? []).map((note) => labeledText('Decision note', note))}
				<h4>Evidence ({result.evidenceCoverage?.satisfied ?? 0}/{result.evidenceCoverage?.required ?? 0} requirements)</h4>
				{evidence.length === 0 ? (
					<p className="sqa-section-empty">No evidence artifact was attached.</p>
				) : (
					<ul className="sqa-evidence-list">
						{evidence.map((artifact, index) => (
							<li key={`${artifact.type}-${index}`}>
								<strong>{humanizeSqaId(artifact.type)}</strong>
								<SafeLink label={String(artifact.reference ?? 'Reference')} href={artifact.reference} />
								{artifact.summary ? <span>{artifact.summary}</span> : null}
							</li>
						))}
					</ul>
				)}
				{requirements.length > 0 ? (
					<ul className="sqa-requirement-list">
						{requirements.map((requirement, index) => (
							<li key={index} data-satisfied={String(Boolean(requirement.satisfied))}>
								{requirement.satisfied ? '✓' : '○'} {requirement.description}
							</li>
						))}
					</ul>
				) : null}
				{result.sources?.length ? (
					<div className="sqa-source-tags">
						{result.sources.map((source) => <code key={source}>{source}</code>)}
					</div>
				) : null}
			</div>
		</details>
	);
}

function SqaControls({ results }: { results: SqaControlResult[] }) {
	return (
		<SqaSection title="Control results" subtitle={`${results.length} applicable control${results.length === 1 ? '' : 's'}`}>
			<div className="sqa-control-list">
				{results.length === 0 ? <p className="sqa-section-empty">No control results were returned.</p> : null}
				{results.map((result) => <SqaControl key={result.controlId} result={result} />)}
			</div>
		</SqaSection>
	);
}

function SqaSources({ frameworks }: { frameworks: NonNullable<SqaAssessment['frameworkCoverage']> }) {
	return (
		<SqaSection title="Source coverage" subtitle="Control crosswalk coverage; source publications remain authoritative.">
			<div className="sqa-source-grid">
				{frameworks.length === 0 ? <p className="sqa-section-empty">No source crosswalk was returned.</p> : null}
				{frameworks.map((framework, index) => (
					<article key={framework.sourceId ?? index} className="sqa-source-card" data-status={framework.status}>
						<div className="sqa-source-title">
							<SafeLink label={String(framework.title ?? framework.sourceId)} href={framework.url as string | undefined} />
						</div>
						<p>{`${Number(framework.controls ?? 0)} mapped controls · ${Number(framework.coverage ?? 0)}% conclusive`}</p>
						<StatusLabel status={String(framework.status ?? '')} />
					</article>
				))}
			</div>
		</SqaSection>
	);
}

export function SqaView({ session }: { session: { sqa?: SqaState; status: string; title?: string; activities?: unknown[] } }) {
	const sqa = session.sqa ?? {};
	const scope = (sqa.scope ?? {}) as Record<string, unknown>;
	const assessment = sqa.assessment ?? null;
	const lifecycle = describeSqaLifecycle(sqa, session.status, session.activities?.length ?? 0);
	const results = assessment?.results ?? [];

	return (
		<div className="sqa-view">
			<aside className="sqa-notice">
				<strong>Assessment boundary</strong>
				<p>{assessment?.disclaimer ?? (scope.disclaimer as string)
					?? 'This scoped engineering assessment is not legal advice, regulatory approval, accreditation, an audit opinion, or certification.'}</p>
			</aside>
			<SqaVerdict assessment={assessment} lifecycle={lifecycle} />
			<SqaScope scope={scope} assessment={assessment} />
			{!lifecycle.finalized && lifecycle.phase === 'ready' ? (
				<div className="sqa-pending">
					<strong>Ready to begin</strong>
					<p>Paste the target URL in the command line below and press Send. A final pass, fail, or blocked verdict appears only after the agent completes the assessment.</p>
				</div>
			) : null}
			{assessment ? (
				<>
					{assessment.technicalSummary ? <SqaTechnicalSummary summary={assessment.technicalSummary} /> : null}
					<SqaCoverage assessment={assessment} />
					<SqaUnresolved assessment={assessment} />
					<SqaControls results={results} />
					<SqaSources frameworks={assessment.frameworkCoverage ?? []} />
				</>
			) : null}
		</div>
	);
}

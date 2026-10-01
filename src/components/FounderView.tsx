import { useState, type ReactNode } from 'react';
import { apiResponse, apiText } from '../api/client';
import { useLiveSession } from '../state/liveSession';
import { useToast } from '../state/toastStore';
import {
	collectFounderAssumptions,
	describeFounderLifecycle,
	founderEvidenceSummary,
	groupFounderObservations,
	resolveFounderQuickWins,
	type FounderObservation,
	type FounderReport,
	type FounderState,
	type FounderTraceItem,
} from '../lib/founderPresentation';
import { humanizeSqaId } from '../lib/sqaPresentation';

const HUMANIZE = humanizeSqaId;

interface FounderCatalog {
	categories?: { id: string; label?: string }[];
	caveat?: string;
}

/** Text or list body for a founder card; arrays render as bullet lists. */
function FounderCardBody({ content, emptyText = 'Not stated.' }: { content: unknown; emptyText?: string }) {
	if (Array.isArray(content)) {
		const values = content.map((item) => String(item).trim()).filter(Boolean);
		if (values.length === 0) return <p>{emptyText}</p>;
		return (
			<ul>
				{values.map((value, index) => <li key={index}>{value}</li>)}
			</ul>
		);
	}
	return <p>{String(content ?? emptyText)}</p>;
}

function FounderTrace({ item }: { item: FounderTraceItem }) {
	const evidenceIds = Array.isArray(item?.evidenceObservationIds) ? item.evidenceObservationIds : [];
	const assumptions = Array.isArray(item?.assumptions) ? item.assumptions : [];
	if (evidenceIds.length === 0 && assumptions.length === 0) {
		return <div className="founder-trace"><span>No trace supplied</span></div>;
	}
	return (
		<div className="founder-trace">
			{evidenceIds.length > 0 ? (
				<span title={evidenceIds.join(', ')}>
					{evidenceIds.length} evidence link{evidenceIds.length === 1 ? '' : 's'}
				</span>
			) : null}
			{assumptions.length > 0 ? (
				<span data-kind="assumption" title={assumptions.join(' · ')}>
					{assumptions.length} assumption{assumptions.length === 1 ? '' : 's'}
				</span>
			) : null}
		</div>
	);
}

function FounderCard({ title, content, meta, trace }: { title: string; content: unknown; meta?: string; trace?: FounderTraceItem }) {
	return (
		<article className="founder-card">
			<strong>{title}</strong>
			{meta ? <span className="founder-card-meta">{meta}</span> : null}
			<FounderCardBody content={content} />
			{trace ? <FounderTrace item={trace} /> : null}
		</article>
	);
}

function FounderSection({ title, subtitle, children }: { title: string; subtitle?: string; children: ReactNode }) {
	return (
		<section className="founder-section">
			<header>
				<h3>{title}</h3>
				{subtitle ? <p>{subtitle}</p> : null}
			</header>
			<div className="founder-section-body">{children}</div>
		</section>
	);
}

function FounderList({ items, emptyText = 'No items recorded.' }: { items: unknown[] | undefined; emptyText?: string }) {
	const values = (Array.isArray(items) ? items : []).map((item) => String(item).trim()).filter(Boolean);
	if (values.length === 0) return <p className="founder-empty">{emptyText}</p>;
	return (
		<ul className="founder-list">
			{values.map((value, index) => <li key={index}>{value}</li>)}
		</ul>
	);
}

function useCategoryLabel() {
	// The launcher already fetched /founder/catalog; a light re-fetch here keeps
	// the view self-sufficient and cache-free (legacy fetched once at boot).
	let catalog: FounderCatalog | undefined;
	try {
		const cached = sessionStorage.getItem('qase-founder-catalog');
		catalog = cached ? (JSON.parse(cached) as FounderCatalog) : undefined;
	} catch {
		catalog = undefined;
	}
	return (id: string | undefined) => {
		const category = (catalog?.categories ?? []).find((item) => item?.id === id);
		return category?.label ?? HUMANIZE(id);
	};
}

function FounderHero({ scope, lifecycle, title }: { scope: FounderState['scope']; lifecycle: ReturnType<typeof describeFounderLifecycle>; title?: string }) {
	const target = scope?.target ?? {};
	return (
		<section className="founder-hero">
			<span className="founder-eyebrow">Founder Mode // evidence-led product review</span>
			<h2>{target.name ?? title ?? 'Founder review'}</h2>
			<p>{lifecycle.detail}</p>
			<span className="founder-status" data-status={lifecycle.status}>{lifecycle.label}</span>
		</section>
	);
}

function FounderScope({ scope }: { scope: FounderState['scope'] }) {
	const target = scope?.target ?? {};
	const context = scope?.productContext ?? {};
	const definitions: [string, string][] = [
		['Release / environment', [target.release, target.environment].filter(Boolean).join(' · ')],
		['Business stage', context.stage ?? ''],
		['Business model', context.businessModel ?? ''],
		['Target customer', context.targetCustomer ?? ''],
		['Primary goal', context.primaryGoal ?? ''],
		['Review lenses', `${scope?.categories?.length ?? 0} categories`],
	];
	return (
		<section className="founder-scope" aria-label="Founder review scope">
			{definitions.map(([label, value]) => (
				<div key={label}>
					<span>{label}</span>
					<strong title={value || undefined}>{value || 'Not provided'}</strong>
				</div>
			))}
		</section>
	);
}

function FounderObservationCard({ observation, categoryLabel }: { observation: FounderObservation; categoryLabel: (id: string | undefined) => string }) {
	const meta = [
		categoryLabel(observation.category),
		HUMANIZE(observation.type),
		`${HUMANIZE(observation.confidence)} confidence`,
		`${observation.evidence?.length ?? 0} evidence artifact${observation.evidence?.length === 1 ? '' : 's'}`,
	].join(' · ');
	return (
		<FounderCard
			title={observation.title ?? 'Untitled observation'}
			content={observation.summary ?? ''}
			meta={meta}
		/>
	);
}

function FounderObservations({ observations, title, subtitle, categoryLabel }: { observations: FounderObservation[]; title: string; subtitle: string; categoryLabel: (id: string | undefined) => string }) {
	return (
		<FounderSection title={title} subtitle={subtitle}>
			<div className="founder-card-grid">
				{observations.map((observation, index) => (
					<FounderObservationCard key={observation.id ?? index} observation={observation} categoryLabel={categoryLabel} />
				))}
			</div>
			{observations.length === 0 ? <FounderList items={[]} emptyText="No matching browser-backed observations were recorded." /> : null}
		</FounderSection>
	);
}

function FounderEvidence({ founder, report }: { founder: FounderState; report: FounderReport }) {
	const fallback = founderEvidenceSummary(founder);
	const declared = report?.evidenceConfidence;
	const confidence = declared?.observationConfidence ?? fallback.confidence;
	const lowCount = confidence?.low ?? 0;
	const reviewed = report?.coverage?.categoriesReviewed?.length ?? fallback.reviewed;
	const total = report?.coverage?.totalCategories ?? fallback.total;
	const ratio = Number(declared?.categoryCoverageRatio);
	const coverage = Number.isFinite(ratio) ? `${Math.round(ratio * 100)}%` : (total ? `${Math.round((reviewed / total) * 100)}%` : '—');
	const metrics: [string, string][] = [
		['Overall rating', HUMANIZE(declared?.rating ?? (lowCount > 0 ? 'low' : 'provisional'))],
		['Observations', String(report?.coverage?.evidenceBackedObservations ?? fallback.observations)],
		['Category coverage', coverage],
		['Browser activities', String(declared?.uniqueBrowserActivities ?? fallback.activities)],
		['High confidence', String(confidence.high ?? 0)],
		['Medium / low', `${confidence?.medium ?? 0} / ${lowCount}`],
		['Explicit assumptions', String(declared?.assumptionCount ?? collectFounderAssumptions(report ?? {}).length)],
	];
	return (
		<FounderSection title="Evidence confidence" subtitle="A transparent view of browser evidence, category coverage, and model confidence.">
			<dl className="founder-evidence-grid">
				{metrics.map(([label, value]) => (
					<div key={label}>
						<dt>{label}</dt>
						<dd>{value}</dd>
					</div>
				))}
			</dl>
			<p className="founder-evidence-note">
				{declared?.limitation
					?? 'Confidence describes the evidence behind this brief; strategic recommendations remain hypotheses to validate with customers and market data.'}
			</p>
		</FounderSection>
	);
}

function FounderIcpPositioning({ report }: { report: FounderReport }) {
	const icp = report.icp ?? {};
	const positioning = report.positioning ?? {};
	const cards: [string, unknown, FounderTraceItem | undefined][] = [
		['Primary ICP', icp.primary, icp as FounderTraceItem],
		['Market category', positioning.category, positioning as FounderTraceItem],
		['Users', icp.users, undefined],
		['Buyers', icp.buyers, undefined],
		['Jobs to be done', icp.jobs, undefined],
		['Customer pains', icp.pains, undefined],
		['One-line positioning', positioning.oneLiner, undefined],
		['Value proposition', positioning.valueProposition, undefined],
		['Differentiators', positioning.differentiators, undefined],
		['Alternatives', positioning.alternatives, undefined],
	];
	return (
		<FounderSection title="ICP & positioning" subtitle="Who this is for, the job it wins, and the clearest market frame.">
			<div className="founder-card-grid">
				{cards.map(([title, content, trace]) => (
					<FounderCard key={title} title={title} content={content} trace={trace} />
				))}
			</div>
		</FounderSection>
	);
}

function FounderMonetization({ report }: { report: FounderReport }) {
	const monetization = report.monetization;
	if (monetization) {
		return (
			<FounderSection title="Monetization & pricing" subtitle="Packaging, value metric, pricing communication, and the next hypotheses to test.">
				<div className="founder-card-grid">
					<FounderCard title="Monetization model" content={monetization.model} trace={monetization as FounderTraceItem} />
					<FounderCard title="Value metric" content={monetization.valueMetric} />
					<FounderCard title="Packages" content={monetization.packages} />
					<FounderCard title="Pricing presentation" content={monetization.pricingPresentation} />
					<FounderCard title="Next pricing tests" content={monetization.nextTests} />
				</div>
			</FounderSection>
		);
	}
	const fallback = (report.recommendations ?? []).filter((item) => item.category === 'monetization_pricing');
	return (
		<FounderSection title="Monetization & pricing" subtitle="Packaging, value metric, pricing communication, and the next hypotheses to test.">
			<div className="founder-card-grid">
				{fallback.map((item) => (
					<FounderCard key={item.id ?? item.title} title={item.title ?? 'Pricing'} content={item.rationale} trace={item} />
				))}
			</div>
			{fallback.length === 0 ? <FounderList items={[]} emptyText="No pricing recommendation was returned for this review." /> : null}
		</FounderSection>
	);
}

function FounderSales({ report }: { report: FounderReport }) {
	const sales = report.sales ?? {};
	return (
		<FounderSection title="Sales & GTM" subtitle="The recommended commercial motion, qualification path, proof, and objection handling.">
			<p className="founder-copy">{sales.motion ?? 'No sales motion was returned.'}</p>
			<FounderTrace item={sales as FounderTraceItem} />
			<div className="founder-card-grid">
				<FounderCard title="Qualification questions" content={sales.qualificationQuestions} />
				<FounderCard title="Sales assets" content={sales.salesAssets} />
				{(sales.objectionResponses ?? []).map((item, index) => (
					<FounderCard key={index} title={`Objection: ${item.objection ?? 'Unspecified'}`} content={item.response} />
				))}
			</div>
		</FounderSection>
	);
}

function FounderMarketing({ report }: { report: FounderReport }) {
	const marketing = report.marketing ?? {};
	return (
		<FounderSection title="Marketing & growth" subtitle="Evidence-linked distribution bets, launch motions, content, and growth loops.">
			<div className="founder-card-grid">
				{(marketing.channels ?? []).map((channel, index) => (
					<FounderCard
						key={index}
						title={channel.channel ?? 'Channel'}
						content={channel.rationale ?? ''}
						meta={`${HUMANIZE(channel.confidence)} confidence`}
						trace={channel as FounderTraceItem}
					/>
				))}
				<FounderCard title="Content angles" content={marketing.contentAngles} />
				<FounderCard title="Launch motions" content={marketing.launchMotions} />
				<FounderCard title="Growth loops" content={marketing.growthLoops} />
			</div>
		</FounderSection>
	);
}

function FounderPriorities({ report }: { report: FounderReport }) {
	const recommendations = report.recommendations ?? [];
	return (
		<FounderSection title="Prioritized opportunities" subtitle={`${recommendations.length} sequenced product and growth decisions.`}>
			<div className="founder-priority-list">
				{recommendations.map((item, index) => (
					<article key={item.id ?? index} className="founder-priority">
						<span className="founder-rank">{String(index + 1).padStart(2, '0')}</span>
						<div>
							<strong>{item.title ?? 'Untitled recommendation'}</strong>
							<p>{item.rationale ?? ''}</p>
							<FounderList items={item.actions} emptyText="No actions supplied." />
							<FounderTrace item={item} />
						</div>
						<div className="founder-scores">
							{([['Impact', item.impact], ['Effort', item.effort], ['Confidence', item.confidence]] as [string, string | undefined][]).map(([label, value]) => (
								<span key={label} className={label === 'Confidence' ? 'founder-confidence' : 'founder-score'}>
									{`${label} ${HUMANIZE(value)}`}
								</span>
							))}
						</div>
					</article>
				))}
			</div>
			{recommendations.length === 0 ? <FounderList items={[]} emptyText="No prioritized recommendations were returned." /> : null}
		</FounderSection>
	);
}

function FounderQuickWins({ report }: { report: FounderReport }) {
	const items = resolveFounderQuickWins(report);
	return (
		<FounderSection title="Quick wins" subtitle="Low-friction moves selected from the prioritized recommendation set.">
			<div className="founder-card-grid">
				{items.map((item) => (
					<FounderCard key={item.id ?? item.title} title={item.title ?? 'Quick win'} content={item.actions} trace={item} />
				))}
			</div>
			{items.length === 0 ? <FounderList items={[]} emptyText="No quick wins were selected." /> : null}
		</FounderSection>
	);
}

function FounderRoadmap({ report }: { report: FounderReport }) {
	const stages: [string, unknown[] | undefined][] = [
		['First 30 days', report.plan?.days30],
		['Days 31–60', report.plan?.days60],
		['Days 61–90', report.plan?.days90],
	];
	return (
		<FounderSection title="30 / 60 / 90 roadmap" subtitle="A staged sequence for validation, execution, and learning.">
			<div className="founder-roadmap">
				{stages.map(([label, items]) => (
					<article key={label} className="founder-roadmap-item">
						<span>{label}</span>
						<FounderList items={items} />
					</article>
				))}
			</div>
		</FounderSection>
	);
}

function FounderRisks({ report }: { report: FounderReport }) {
	const assumptions = collectFounderAssumptions(report ?? {});
	return (
		<FounderSection title="Risks & assumptions" subtitle={`${report.risks?.length ?? 0} explicit risks · ${assumptions.length} hypotheses requiring validation.`}>
			<div className="founder-card-grid">
				{(report.risks ?? []).map((risk, index) => (
					<FounderCard
						key={index}
						title={risk.title ?? 'Risk'}
						content={risk.mitigation}
						meta={`Likelihood ${HUMANIZE(risk.likelihood)} · Impact ${HUMANIZE(risk.impact)}`}
						trace={risk as FounderTraceItem}
					/>
				))}
			</div>
			{assumptions.length > 0 ? (
				<ul className="founder-assumption-list">
					{assumptions.map((item, index) => (
						<li key={index}><strong>{item.source}</strong> — {String(item.text)}</li>
					))}
				</ul>
			) : null}
		</FounderSection>
	);
}

function FounderMetrics({ report }: { report: FounderReport }) {
	const metrics = report.metrics ?? {};
	return (
		<FounderSection title="Metrics & experiments" subtitle="Decision metrics, learning loops, guardrails, and falsifiable next tests.">
			<div className="founder-card-grid">
				{metrics.northStar ? (
					<FounderCard title={`North star: ${metrics.northStar.name ?? 'Unnamed'}`} content={metrics.northStar.definition} meta={metrics.northStar.why} trace={metrics.northStar as FounderTraceItem} />
				) : null}
				{(metrics.candidates ?? []).map((item, index) => (
					<FounderCard key={index} title={`Candidate: ${item.name ?? 'Unnamed'}`} content={item.definition} trace={item as FounderTraceItem} />
				))}
				{(metrics.experiments ?? []).map((item, index) => (
					<FounderCard
						key={index}
						title={`Experiment ${index + 1}: ${item.hypothesis ?? 'Untitled hypothesis'}`}
						trace={item as FounderTraceItem}
						content=""
					/>
				))}
			</div>
		</FounderSection>
	);
}

function FounderBoundary({ caveat }: { caveat?: string }) {
	return (
		<aside className="founder-boundary">
			<strong>Decision boundary</strong>
			<p>
				{caveat
					?? 'Founder Mode provides evidence-informed product guidance. Validate recommendations with customers and market data before committing resources.'}
			</p>
		</aside>
	);
}

function FounderReportActions({ sessionId }: { sessionId: string }) {
	const { toast } = useToast();
	const [busy, setBusy] = useState(false);

	const reportError = (error: unknown) => {
		const err = error as Error & { status?: number };
		if (err?.status === 409) {
			toast('The report is still being finalized — try again once the run completes.', 'bad');
			return;
		}
		toast(err?.message ?? 'The export failed.', 'bad');
	};

	const downloadMarkdown = async () => {
		try {
			const markdownText = await apiText(`/sessions/${sessionId}/report.md`);
			const url = URL.createObjectURL(new Blob([markdownText], { type: 'text/markdown;charset=utf-8' }));
			const save = document.createElement('a');
			save.href = url;
			save.download = 'qase-founder-review.md';
			document.body.append(save);
			save.click();
			save.remove();
			window.setTimeout(() => URL.revokeObjectURL(url), 0);
		} catch (error) {
			reportError(error);
		}
	};

	const copyReport = async () => {
		try {
			const markdownText = await apiText(`/sessions/${sessionId}/report.md`);
			await navigator.clipboard.writeText(markdownText);
			toast('Founder report copied to the clipboard.', 'good');
		} catch (error) {
			reportError(error);
		}
	};

	const downloadPdf = async () => {
		setBusy(true);
		try {
			const response = await apiResponse(`/sessions/${sessionId}/report.pdf`);
			const blob = await response.blob();
			const url = URL.createObjectURL(blob);
			const save = document.createElement('a');
			save.href = url;
			save.download = 'qase-founder-review.pdf';
			document.body.append(save);
			save.click();
			save.remove();
			window.setTimeout(() => URL.revokeObjectURL(url), 0);
		} catch (error) {
			reportError(error);
		} finally {
			setBusy(false);
		}
	};

	return (
		<div className="report-actions founder-report-actions" role="group" aria-label="Founder report actions">
			<button type="button" className="btn btn-ghost btn-sm" onClick={() => void downloadMarkdown()}>Download .md</button>
			<button type="button" className="btn btn-ghost btn-sm" onClick={() => void copyReport()}>Copy report</button>
			<button type="button" className="btn btn-primary btn-sm" disabled={busy} onClick={() => void downloadPdf()}>
				{busy ? 'Preparing…' : 'Download PDF'}
			</button>
		</div>
	);
}

export function FounderCompletedReport({ founder, report }: { founder: FounderState; report: FounderReport }) {
	const { session } = useLiveSession();
	const categoryLabel = useCategoryLabel();
	const observations = groupFounderObservations(founder.observations);
	return (
		<>
			{session ? <FounderReportActions sessionId={session.id} /> : null}
			<FounderEvidence founder={founder} report={report} />
			<FounderSection title="Executive thesis" subtitle="The concise product, market, and execution diagnosis.">
				<p className="founder-copy founder-copy--lead">{report.executiveSummary ?? 'No executive summary was returned.'}</p>
			</FounderSection>
			<FounderObservations observations={observations.productFindings} title="UI, UX & product findings" subtitle="Evidence observed directly on the product surface." categoryLabel={categoryLabel} />
			<FounderIcpPositioning report={report} />
			<FounderSales report={report} />
			<FounderMarketing report={report} />
			<FounderMonetization report={report} />
			<FounderPriorities report={report} />
			<FounderQuickWins report={report} />
			<FounderRoadmap report={report} />
			<FounderRisks report={report} />
			<FounderMetrics report={report} />
			<FounderBoundary caveat={report.caveat} />
		</>
	);
}

export function FounderView({ session }: { session: { founder?: FounderState; status: string; title?: string; activities?: unknown[]; mode?: string } }) {
	const founder = session.founder ?? {};
	const scope = founder.scope ?? {};
	const report = founder.report;
	const lifecycle = describeFounderLifecycle(founder, session.status, session.activities?.length ?? 0);

	return (
		<div className="founder-view">
			<FounderHero scope={scope} lifecycle={lifecycle} title={session.title} />
			<FounderScope scope={scope} />
			{!report ? (
				<>
					{founder.observations?.length ? (
						<FounderObservations
							observations={founder.observations}
							title="Live evidence log"
							subtitle="Browser-backed strengths, frictions, opportunities, and risks captured during this review."
							categoryLabel={() => ''}
						/>
					) : null}
					<div className="founder-pending">{lifecycle.message}</div>
					<FounderBoundary />
				</>
			) : (
				<FounderCompletedReport founder={founder} report={report} />
			)}
		</div>
	);
}

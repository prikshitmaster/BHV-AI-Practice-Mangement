PRODUCT REQUIREMENTS / VERSION 1.0

BHV Practice Management

One clear workspace. Separate firm accountability. Evidence behind every
completed job.

Product Requirements Document\
Prepared for B H Vyas and Associates, a partnership firm, and B H Vyas
and Company, a proprietorship concern.

This PRD defines an original practice management product for the two BHV
practices. It covers the operational core, Indian professional service
workflows, security, controlled AI assistance, client collaboration and
the engineering conditions required before release. It is intended for
the engineer, practice owner, reviewing CA and implementation team.

## Product outcome

Every engagement should show the responsible practice, client, period,
owner, deadline, missing information, next action, reviewer and evidence
of completion. Staff should work from a short personal queue. Partners
and the proprietor should see exceptions, review bottlenecks, collection
status and workload without searching across spreadsheets and messages.

## Design commitments

-   Keep daily navigation simple. Offer specialist practice modules
    through role and service configuration, with light and dark themes
    and restrained colours.

-   Treat the shared domain as an access location. It does not establish
    authority to view the other practice's clients, finances, working
    papers or credentials.

-   Require human approval for professional conclusions, filings,
    signatures, payments, recipient changes and external AI disclosure.

-   Build a secure operational core first, then professional packs and
    integrations. Every release has demonstrable acceptance criteria.

## Status and authority

Version 1.0 • Research date: 7 September 2026 • Status: detailed
proposed baseline for owner and engineer review. User supplied facts are
distinguished from design assumptions and externally verified sources.
This is a specification, not proof of implementation, security
certification, legal compliance or superiority to every competing
product.

Working product name: BHV Practice Management. Actual registered names,
proprietor identity, FRNs, GSTINs, PANs, bank accounts, staff numbers,
hosting location and signing authority must be verified during
onboarding. No actual credentials are supplied or invented.

PRODUCT REQUIREMENTS / 02

# Reading guide, facts and decisions

Read the core rules first; use the module sections as buildable work
packages.

  -----------------------------------------------------------------------
  **Sections**    **What they contain**
  --------------- -------------------------------------------------------
  3 to 5          Product, LinkedIn and ICAI research, with evidence
                  limitations.

  6 to 10         Scope, legal practice boundaries, permissions and
                  credentials.

  11 to 30        Client work, compliance, documents, audit, finance,
                  people and AI.

  31 to 37        Integration, data contracts, security, privacy and
                  recovery.

  38 to 42        Themes, navigation, reporting, performance and
                  acceptance tests.

  43 onward       Migration, release plan, engineering handover,
                  decisions, requirement index and sources.
  -----------------------------------------------------------------------

## Facts supplied by the owner

Two practices share a domain. B H Vyas and Associates is a partnership;
B H Vyas and Company is a proprietorship. The product must support
small, medium and large CA practices, personal logins, role based
access, a Practice menu, an inbuilt manual and visually calm light and
dark themes. The employee avatar exercise and AI spend tracker can
become internal training and administration use cases; they are not
prerequisites for this product.

## Proposed operating assumptions

The first installation serves BHV, with configurable branches and
service teams. A common party directory may link the same client across
practices, but each client relationship, engagement and record remains
scoped. English is the initial interface; Hindi and Gujarati are
supported for approved templates and later interface localisation. INR
is the default reporting currency; India dates and Asia/Kolkata are
defaults, not hardcoded global assumptions.

A proprietorship is represented as an operational practice belonging to
its verified proprietor; the data model must not imply that the trade
name creates a company separate from that individual. Legal identifiers
are stored with their correct holder and entity type.

## How to read requirement IDs

R0 means secure operational core; R1 means professional practice depth;
R2 means advanced integration and scale. These are release priorities,
not different security grades. IDs persist through engineering tickets,
tests and change requests. An acceptance example is a minimum check; it
does not replace the full test suite.

No additional LinkedIn profiles or competitor links were supplied.
Publicly accessible relevant profiles and product pages were selected
for discovery; access gaps are recorded in section 5. Sources appear as
\[Sxx\] and \[Ixx\] in the text and as clickable references at the end.

PRODUCT REQUIREMENTS / 03

# What existing products contribute

Adopt useful patterns; validate them in BHV's Indian practice context.

  --------------------------------------------------------------------------
  **Reference**   **Observed public pattern**  **BHV design consequence**
  --------------- ---------------------------- -----------------------------
  Jamku \[S01\]   Indian practice registers,   Include DSC custody, inward /
                  tasks, compliance, time,     outward records and notice
                  hearings and costing.        tracking within the work
                                               model.

  Zoho Practice   Client requests, recurring   Use service templates,
  \[S02\]         work, workpapers, workflow   structured requests and
                  history and a portal.        visible automation logs.

  Karbon \[S03\]  Workflow, communication,     Attach conversations to work;
                  engagement, billing,         provide saved queues and
                  capacity and reporting       partner exception views.
                  context.                     

  TaxDome \[S04\] Pipelines, questionnaires,   Use guided intake and
                  engagement letters, client   accessible help. Do not
                  portal and wiki.             automatically withhold
                                               statutory or client owned
                                               records for unpaid fees.

  FYI \[S05\]     Document and email filing,   Give each record a client,
                  approvals, tasks and         practice, engagement, version
                  automation.                  and review status.

  CCH iFirm       Central client information   Maintain coherent master data
  \[S06\]         and a connected practice     while preserving separately
                  ecosystem.                   authorised practice records.
  --------------------------------------------------------------------------

## What is not established by this research

Public product descriptions do not establish security effectiveness,
actual uptime, Indian filing coverage, vendor suitability or feature
availability in every plan. No paid demonstrations or penetration tests
were performed. CCH regional editions differ. Upcoming AI features were
treated as roadmap claims. Vendor productivity percentages were not used
as BHV forecasts.

## Build versus buy

A configured existing product is the fastest benchmark for routine work
management. A custom product becomes justified by the combined need for
separately governed BHV practices, local data control, specific
professional review gates and integration with the firm's tools. Before
commissioning every module, compare a representative workflow against a
configured product demo and a measured custom prototype. Preserve
exportability regardless of the decision.

Proposed differentiation: explicit practice context, versioned Indian
compliance rules, evidence based completion, local AI routing, a
practical training area and safe handling of shared staff. These are
design objectives to test, not market leadership claims.

PRODUCT REQUIREMENTS / 04

# ICAI use cases: ideas and safeguards

The ICAI directory is a discovery source. A listed contribution is not
proof of production readiness or regulatory approval.

The supplied directory includes office management, deadline tracking,
timesheets, certificates, invoice processing, notices and document
automation. Selected underlying submissions were inspected where
accessible. The sources and access limits are recorded in the research
appendix. \[I01\]

  ------------------------------------------------------------------------
  **Pattern to       **Requirement to retain**  **Boundary to enforce**
  evaluate**                                    
  ------------------ -------------------------- --------------------------
  Practice           Unified client, work,      All reads and actions
  management \[I02\] deadline and staff views.  carry practice and
                                                assignment scope.

  TimeTrack \[I03\]  Project timers, manual     No covert screenshots,
                     entries and useful         keystroke capture or
                     utilisation summaries.     surveillance scoring.

  InvoicePro \[I04\] Reusable particulars,      Versioned tax rules;
                     calculations and           approved invoices have
                     receivable tracking.       immutable identity and a
                                                correction trail.

  CERTIFY GENIE      Evidence checklist,        An authorised CA decides
  \[I05\]            document assembly and      scope, verifies facts and
                     approval workflow.         signs; no automatic
                                                certification.

  Deadline           Recurring obligations,     Source backed
  automation \[I07\] reminders and escalation.  applicability and
                                                effective dates; no
                                                invented extensions.

  CA Digital         Structured intake and      Human verification of
  Assistant \[I06\]  classification linked to   critical fields; no silent
                     client and period.         posting or overwriting
                                                originals.
  ------------------------------------------------------------------------

## Proposed use case policy

Each adopted idea enters a Use Case Register with problem, user, source,
data required, expected output, risks, human decision point, release
priority and acceptance example. Reusable templates are authored for BHV
rather than copied from demonstrations. Demo shortcuts, such as disabled
verification or fixed tax assumptions, are prohibited in production.

Separate maturity labels: Observed concept, Prototype evaluated,
Approved for pilot, Production approved and Retired. A video or
screenshot proves only what is visible. A tool title does not prove its
hidden permissions, retention controls or accuracy. Inaccessible pages
may suggest research topics but cannot support detailed claims.

Virasat AI \[I08\] contributes the idea of linked family / business
context without automatic access. DeltaBooks \[I09\] contributes
confirmation and reconciliation lifecycles. Keep source references with
approved templates; use synthetic training records.

PRODUCT REQUIREMENTS / 05

# LinkedIn evidence and research limits

Public professional material informed workflow priorities, not personal
assessments or unsupported product rankings.

  -----------------------------------------------------------------------
  **Public material**  **Evidence quality**       **Implication**
  -------------------- -------------------------- -----------------------
  Jamku product        Accessible company product Use Indian professional
  profile \[S07\]      description. Adoption      terminology; do not
                       figures refer to June      present old user counts
                       2022.                      as current.

  Karbon company       Accessible company         Support remote teams,
  profile \[S08\]      positioning about          scoped visibility and
                       connected and distributed  individual
                       teams.                     accountability.

  Jason Staats         Public sponsored post /    Test an end to end
  demonstration        transcript describes saved manager journey.
  \[S09\]              views, capacity and        Sponsorship is
                       communication.             disclosed; this is not
                                                  an independent review.

  Adarsh Madrecha      A search snippet was       No detailed profile or
  profile \[S10\]      available; full profile    personal expertise
                       retrieval failed.          analysis is claimed.
  -----------------------------------------------------------------------

## Problems the research suggests testing with staff

-   A manager can see which jobs are blocked by client information and
    which await internal review without reading every conversation.

-   A client can respond to a request without learning the entire
    application or sending the same record repeatedly.

-   Shared staff can switch practice context without mixing invoices,
    signatures, correspondence or files.

-   A partner can open a completed filing and find the approved version,
    acknowledgement and reviewer evidence quickly.

## Evidence discipline for the engineer

Maintain a design evidence register. Record whether an assertion comes
from a user interview, official page, public demonstration, legal source
or tested prototype. Save the source date and the decision it
influenced. Marketing statements are not acceptance evidence. Obtain
representative BHV walkthroughs before finalising field layouts and
automations.

Private posts, authenticated profile content, private messages and
historical feed coverage were not available. The research is a targeted
review of relevant publicly accessible material, not an exhaustive audit
of LinkedIn or every practice management app. No user account was
accessed and no person was contacted.

Do not scrape personal contact details or build lead generation into
this specification. Engagement intake is permitted; unsolicited outreach
and bulk marketing are outside the baseline.

PRODUCT REQUIREMENTS / 06

# Releases, scale and architecture choice

A single product should grow by configuration and capacity, while
keeping the small practice interface short.

  ------------------------------------------------------------------------
  **Release**   **Included outcomes**                **Exit gate**
  ------------- ------------------------------------ ---------------------
  R0 • Secure   Two practice setup; access controls; Cross practice
  core          clients; engagements; work;          isolation, restore
                deadlines; documents; basic portal   drill and realistic
                and messaging; billing register;     client workflow pass.
                manual; logs and backups.            

  R1 • Practice Audit workpapers; notices;           CA approved templates
  depth         certificates / UDIN tracking;        and professional
                advanced billing, time / capacity,   review controls pass.
                service packs, retention and quality 
                workflows.                           

  R2 •          Approved connectors; local AI / RAG; Data leakage,
  Controlled    advanced analytics; enterprise       connector recovery
  expansion     identity; larger deployments and     and measured load
                optional additional tenants.         gates pass.
  ------------------------------------------------------------------------

  ------------------------------------------------------------------------
  **Planning   **Synthetic load envelope**       **Experience**
  profile**                                      
  ------------ --------------------------------- -------------------------
  Small        Up to 15 staff; 500 clients;      Personal queue and core
               5,000 open jobs.                  menu. Optional modules
                                                 hidden.

  Medium       Up to 75 staff; 3,000 clients;    Teams, branches, review
               30,000 open jobs.                 queues and capacity
                                                 planning.

  Large        Up to 300 staff; 15,000 clients;  Delegated administration,
               150,000 open jobs.                enterprise identity and
                                                 permission aware
                                                 reporting.
  ------------------------------------------------------------------------

These are design and test envelopes, not estimates of BHV's actual size
or guaranteed capacity. The engineer must measure the target profile
with realistic attachments, permissions, concurrent users and search.
Avoid separate codebases for each profile.

## Recommended technical direction

Use a modular web application with one transactional core, background
workers, a relational database and versioned object storage. This keeps
cross module actions understandable and deployable by a small
engineering team. Separate modules internally; split services only when
measured scale or security boundaries justify it.

Evaluate firm controlled hosting as the baseline. Managed India cloud
hosting is an alternative if approved for operations and client
commitments. Local AI is a separate service; it must not compete with
the operational database for all resources. A desktop application or
spreadsheet is unsuitable as the primary shared authority for this
scope.

One hired engineer can deliver a scoped pilot with review support.
Production security, professional templates, migration and operations
need named owners and independent checks; a solo delivery promise does
not replace those functions.

PRODUCT REQUIREMENTS / 07

# Practice boundaries and shared administration

A combined view is a permission. It is never the default consequence of
sharing an email domain.

**ORG01 \| R0 \| Hierarchy.** Model Tenant / Practice Group, Practice,
Branch, Team, Membership, Client Relationship and Engagement. BHV
initially uses one group with two practices. Every financial and
professional record has a nonblank owning practice; tenant boundaries
remain available for future separate customers.

**ORG02 \| R0 \| Practice identity.** Store constitution, registered
display name, identifier holder, FRN where applicable, PAN, GST
registrations, addresses, bank accounts, letterheads and authorised
signatories as verified configuration with effective dates. Do not
assume that the proprietor is CA Panav Vyas without confirmation.

**ORG03 \| R0 \| Firm switcher.** Show the active practice in the header
and every create, send, invoice, signoff and export confirmation. In
Combined view, creation requires choosing a practice. Changing context
clears or revalidates selected recipients, accounts and drafts.

**ORG04 \| R0 \| Separate records.** Invoice series, engagements,
permissions, credentials, document namespaces and bank mappings are
independent. A client served by both practices has two client
relationships and two engagement contracts. Shared PAN or contact
details do not merge the work.

**ORG05 \| R0 \| Explicit sharing.** Share a specific document or
contact field only through a logged grant naming the receiving practice,
purpose and expiry. New versions do not inherit cross practice sharing
unless explicitly selected. Revocation removes future access but cannot
retract already downloaded copies.

**ORG06 \| R1 \| Shared resource allocation.** Staff time and shared
expenses may be allocated to both practices using approved allocation
records. This is an internal allocation, not automatically an invoice or
tax conclusion. Consolidated dashboards identify included practices and
avoid double counting shared resources.

**Acceptance evidence:** Create the same fictional client in both
practices; verify different engagement letters, bank details and invoice
series. An Associates only staff user must fail access through URL, API,
search, export, email job, object link and AI retrieval for Company
records.

Edge cases: a practice rename preserves old signed artefacts; a
partnership change does not overwrite earlier signatory facts; a
deactivated practice stays read only under retention and legal hold
rules.

PRODUCT REQUIREMENTS / 08

# Roles and permission rules

Access is determined by identity, practice membership, role, assignment,
record sensitivity and action.

**IAM01 \| R0 \| Deny by default.** Enforce authorisation on the server
for every read, mutation, export, background job, search result and
attachment. Hiding a menu is not an access control. Permission checks
use the stored record scope, not a client supplied practice ID alone.

**IAM02 \| R0 \| Role definitions.** Provide Group Owner, Practice
Partner / Proprietor, Manager, Reviewer, Staff / Article, Finance, HR,
IT Administrator, Quality Reviewer and Client Contact roles. A person
can hold different roles in each practice. Distinguish IT control from
professional data authority.

**IAM03 \| R0 \| Assignment scope.** Support own work, assigned
engagements, team, branch, practice and approved combined scopes. Deny
restricted HR, credentials, fee rates or protected workpapers unless an
explicit additional permission exists. Document exceptions must never
broaden the parent engagement invisibly.

**IAM04 \| R0 \| Separation of duties.** An author cannot approve the
same sensitive output by default. Require independent review for
filings, invoices above configured limits, signoff and credential
exports. For a sole reviewer situation, use a disclosed self review
exception with reason and quality review follow up; legal prohibitions
cannot be overridden.

**IAM05 \| R0 \| Lifecycle.** Invite verified users; assign sponsor,
practice and role; record acceptance and MFA; review access
periodically. Suspend leavers immediately, revoke sessions and transfer
work. Preserve authorship and historical activity after account closure.

**IAM06 \| R1 \| Delegation and conflicts.** Allow temporary delegation
with explicit scope, expiry and excluded actions. Conflict or
independence restrictions override ordinary role membership. Break glass
access requires reason, short duration, visible alert and independent
review; it must not bypass tenant isolation.

**Acceptance evidence:** A manager assigned to both firms sees only
authorised teams; an article cannot grant access or approve their own
filing. Revocation invalidates active sessions and queued exports before
further disclosure. Background workers recheck membership when
executing.

Client contacts are linked to a specific legal client and practice
relationship. A director, group CFO or family member receives access
through explicit mandates, not automatically through shared surname,
domain or corporate group membership.

PRODUCT REQUIREMENTS / 09

# Permission matrix and approval ownership

Role presets are starting templates. Record level restrictions and
separation of duties continue to apply.

  ----------------------------------------------------------------------------
  **Action**     **Partner /    **Manager /      **Staff /   **Specialist /
                 proprietor**   reviewer**       article**   client**
  -------------- -------------- ---------------- ----------- -----------------
  Client /       Approve own    Create assigned  Read        Client: own
  engagement     practice       drafts           assigned    released profile

  Work /         Practice scope Assigned team    Assigned    Client: request
  documents                     scope            work only   uploads and
                                                             released files

  Professional   Authorised CA  Prepare / review Prepare     Quality reviewer:
  signoff        only           if authorised    only        scoped review

  Invoices /     Approve;       Draft if         No fee      Finance: draft,
  collections    configure      delegated        access by   reconcile;
                 limits                          default     client: own
                                                             issued invoices

  HR / pay /     Explicit HR    Capacity only by Own time /  HR: permitted
  cost rates     authority      default          leave       personnel records

  Portal         Explicit       No default       No default  IT:
  credentials /  custody /      secret access    secret      infrastructure,
  DSC            access grant                    access      not signing
                                                             authority

  Export /       Scoped and     Allowed          Disabled    Client: only
  sharing        logged         categories only  bulk export released own
                                                             files

  Roles / policy Group owner or No broad         None        IT: account
                 practice grant administration               operations under
                                                             approved tickets
  ----------------------------------------------------------------------------

## Approval catalogue

Each service template identifies preparation, review, authorisation and
filing roles separately. An engagement partner's business approval does
not substitute for the professional eligibility of the actual signatory.
The Group Owner role does not automatically confer CA signing rights or
unrestricted access to confidential working papers.

Record approval subject, exact version or hash, decision, reviewer
identity, timestamp, comments and pending conditions. Editing the
approved content invalidates downstream approvals and returns the item
to review. For high impact bulk actions, show count, owning practice,
recipients and sample records before confirmation.

## Administrative boundaries

IT can reset an account using the recovery procedure but cannot read
stored portal passwords or sign a report through that privilege. Finance
cannot see audit findings merely because a client owes fees. HR sees
personnel files but not client tax records. Quality review access is
time and engagement scoped, with export separately controlled.

**Acceptance evidence:** Provide a permission simulator for
administrators: select a user, record and action to explain Allowed or
Denied without exposing the protected content. Test role conflicts,
delegation expiry and a changed firm context during a pending approval.

PRODUCT REQUIREMENTS / 10

# Login, credentials and signing devices

There must be individual accountability from onboarding to every
sensitive action.

**AUTH01 \| R0 \| Authentication.** Use an established identity service
or maintained authentication library. Support individual email login
with MFA. Require MFA for staff; privileged users use phishing resistant
methods where available. No shared admin login, default password or
production account seeded from demo data.

**AUTH02 \| R0 \| Sessions and recovery.** Use secure cookies, CSRF
controls, server enforced expiry, device/session review and immediate
revocation. Proposed defaults: 30 minute idle timeout and 12 hour
maximum staff session, with warning. Step up authentication for exports,
role changes and secret reveal. Recovery is verified, logged and cannot
silently remove MFA.

**AUTH03 \| R0 \| Invitation and bootstrap.** Initial owner activation
uses a single use expiring setup mechanism delivered through an approved
channel. Invitations expire after a configurable period, default 48
hours. Joining a known email domain does not enrol a user in both
practices. Rate limit login and invitation attempts.

**AUTH04 \| R1 \| Portal secret vault.** Prefer delegated portal access
or OAuth. Where a password must be held, encrypt it in a dedicated
secret store with separate key permissions. Reveal requires explicit
grant, reason, step up authentication and a log. Never expose secrets in
logs, browser storage, email, exports or AI context.

**AUTH05 \| R0 \| DSC custody register.** Track owner, certificate
identifier, expiry, token custodian, issue / return dates and purpose.
Do not store private keys or token PINs in ordinary tables. A custody
record does not authorise signing; signatures require the entitled
person through a separately approved flow.

**AUTH06 \| R2 \| Enterprise identity.** Support SSO and automated user
provisioning when justified by scale. Map identity groups into reviewed
practice roles. A disabled corporate account must lose app sessions and
connector authorisations. Service accounts have scoped noninteractive
credentials, owners and rotation schedules.

**Acceptance evidence:** Verify reset and MFA recovery with the owner
absent; there must be a documented authorised substitute process. Search
logs and exported backups for plaintext secrets. A demo "admin/admin"
account must never be deployable to production.

Actual account names, domain configuration, email delivery provider and
signing integrations are setup decisions. Never put working passwords or
recovery codes in this PRD or in a user manual.

PRODUCT REQUIREMENTS / 11

# Client registry, intake and acceptance

One accurate client identity can support several separately governed
relationships.

**CLI01 \| R0 \| Client structure.** Maintain Party, Client Relationship
and Contact separately. Capture legal name, constitution, identifiers,
addresses, registrations, responsible contacts, group links, authorised
representatives and verified communication channels. Allow multiple GST
registrations and businesses without duplicating a person unnecessarily.

**CLI02 \| R0 \| Duplicate resolution.** Match identifiers through a
restricted master data process. Normal staff receive a nonrevealing
duplicate warning where another practice owns the match. Merging
requires a preview, authority, preserved old IDs and rollback plan;
never merge documents or engagement rights automatically.

**CLI03 \| R0 \| Guided intake.** Collect only fields needed for the
selected service. Save incomplete drafts; mark verification status and
source for critical fields. Imported PAN, GSTIN, bank details and email
addresses remain unverified until checked. Validation of format is not
proof of identity or registration status.

**CLI04 \| R0 \| Acceptance and conflict check.** Before active
engagement, record scope, competence, resources, ethical threats,
independence assessment where relevant, predecessor communication where
applicable, client authority and partner decision. Screen related
entities and both BHV practices without disclosing restricted details
unnecessarily. \[S13\]\[S14\]

**CLI05 \| R1 \| Continuance and changes.** Schedule continuance review,
expiry of mandates and contact revalidation. Changes to legal name, bank
account, authorised signatory or ownership generate review tasks.
Deceased individuals, dissolved entities and terminated relationships
retain history and restrict new transactions appropriately.

**CLI06 \| R0 \| Client 360 screen.** Show authorised overview,
engagements, obligations, requests, documents, communication, invoices
and important alerts. Each tab is permission aware. A combined
relationship view clearly separates practices; client groups are
navigational links, not automatic access grants.

**Acceptance evidence:** Onboard a fictional company with two GST
registrations, a director contact and engagements in both practices.
Reject an unauthorised email change; retain source evidence; expose no
other client data through autocomplete or duplicate detection.

Required completion fields depend on service and entity type. Store
optional identifiers only for a documented purpose. Never require
Aadhaar simply because a generic client form contains that field.

PRODUCT REQUIREMENTS / 12

# Service catalogue and engagements

A client is not a job. Every agreed service has an engagement with
scope, period and authority.

**ENG01 \| R0 \| Service catalogue.** Create versioned service templates
for accounting, tax, GST, TDS, statutory audit, tax audit, internal
audit, corporate compliance, notices, certification and advisory.
Templates define applicability inputs, document checklist, steps, roles,
review gates, deliverables and fee model.

**ENG02 \| R0 \| Engagement record.** Require practice, client
relationship, service, period, engagement owner, reviewer, planned
dates, scope, exclusions, fee basis, billing entity and status. Support
annual retainers with linked period jobs and ad hoc engagements. Do not
create a second fee obligation merely because a subtask exists.

**ENG03 \| R0 \| Terms and authority.** Generate an engagement letter
from an approved template, populate verified facts and route draft to
review. Store sent version, acceptance evidence and signatory capacity.
Typed consent, electronic acceptance and legally effective signature are
distinct records; use an approved signing method for the document type.

**ENG04 \| R0 \| Change control.** A scope, fee, period or practice
change after acceptance creates a revision or supplemental engagement.
Preserve the original. Reassigning the responsible legal practice
requires documented client arrangements and new authority; changing a
dropdown is insufficient.

**ENG05 \| R1 \| Independence across services.** Link assurance and
nonassurance services, related entities, personnel conflicts and network
assessment. The ethics assessment considers both practices where
relevant; database separation does not remove self review or other
independence threats. Record the professional conclusion and safeguards.
\[S13\]

**ENG06 \| R0 \| Closure and termination.** Close only when required
work, reviews and release evidence are complete, or record an authorised
termination reason. Distinguish completion, withdrawal, cancellation and
nonapplicability. Keep outstanding fees and retained documents traceable
after service closure.

**Acceptance evidence:** Change an accepted annual retainer to add
litigation work. The original scope stays intact; a new fee and
authority review appears; existing GST jobs are not recreated. An
independence block prevents activation until an eligible reviewer
resolves it.

Small practice mode may combine operational roles, but it must display
review responsibilities explicitly and never waive a statutory or
professional restriction.

PRODUCT REQUIREMENTS / 13

# Workflows, recurring jobs and staff queues

The next action, owner and blocker should be visible without opening a
long history.

**WRK01 \| R0 \| Work model.** Separate Engagement, Job, Task, Checklist
Item and Client Request. Capture owner, reviewer, priority, period,
deadline links, dependency, estimate, tags and attachments. Required
steps can be completed only by the authorised role; optional steps
record Not applicable with reason.

**WRK02 \| R0 \| State machine.** Use Draft, Ready, In progress, Waiting
for client, Waiting internally, In review, Changes requested, Approved
for action, Submitted / Delivered, Completed, Cancelled and Reopened.
Service templates may hide unused states but preserve the underlying
approval and evidence rules.

**WRK03 \| R0 \| Recurrence.** Generate jobs using a unique key of
practice, client relationship, stable template / obligation identity and
period. Store template version as snapshot metadata, not as the
duplicate prevention identity. Preview bulk creation. Template edits
affect future jobs; migration of open jobs needs reviewed approval.

**WRK04 \| R0 \| Dependencies and blocking.** Block a task when its
required predecessor or evidence is missing. A client delay pauses the
internal response clock only under the defined SLA; it never silently
moves the statutory deadline. Escalation continues for legal risk even
when client information is pending.

**WRK05 \| R0 \| Queue and reassignment.** Offer My work, Team work,
Review queue, Waiting for client and Overdue saved views. Reassign with
reason and notification; include active timers and pending approvals.
Employee exit generates a handover list, not orphaned jobs.

**WRK06 \| R1 \| Automation designer.** Allow an administrator to
configure approved triggers, conditions and actions from a limited
library. Show preview, affected records, recipients, frequency and
rollback where possible. Disallow arbitrary code execution from a
business rule. Record rule version, actor, run ID and result.

**Acceptance evidence:** Run the monthly job generator twice; only one
job exists per key. Request changes after review and verify the previous
approval is invalidated. Reopen a completed job without changing its
original filing evidence or deleting its completion history.

The board is an optional view of the same work records. Dragging a card
must invoke the same server rules as the form and API; it cannot bypass
review requirements.

PRODUCT REQUIREMENTS / 14

# Statutory calendar and deadline intelligence

Separate law, internal planning, client submission and payment dates.

**DUE01 \| R0 \| Obligation rule.** Store jurisdiction, governing law,
service, taxpayer category, applicability conditions, relevant period,
form version, due date expression, authoritative source, source date,
effective interval and approving CA. Rules move through Draft, Reviewed,
Active, Superseded and Retired.

**DUE02 \| R0 \| Deadline instance.** For each client obligation
preserve original statutory date, current statutory date, internal
preparation target, review target, client document cutoff and payment
deadline where relevant. Show the source and reason for each revision.
Store Unknown applicability as a review state, not as Not applicable.

**DUE03 \| R0 \| Extensions.** An approved notification produces a
preview of affected open instances. Apply only to matching category,
period and jurisdiction. Preserve old values and linked source. Do not
reopen completed filings automatically or alter historical on time
metrics without an explicit report policy.

**DUE04 \| R0 \| Alerts and evidence.** Escalate by configurable
intervals and responsible role. Distinguish Due soon, Overdue, Waiting,
Submitted awaiting acknowledgment, Filed, Rejected and Not applicable.
Filing completion requires acknowledgement / reference evidence and
reviewer confirmation; marking a task Done is insufficient.

**DUE05 \| R1 \| Regulatory update inbox.** Collect official updates
through permitted sources, detect candidate rule changes and present a
comparison. A reviewing CA confirms interpretation before activation. AI
suggestions cannot edit the active calendar or certify the absence of
extensions.

**DUE06 \| R0 \| Calendar behaviour.** Use India defaults with explicit
local time and date only obligations. Holidays may move internal
reminders; statutory dates change only when the applicable rule permits.
Calendar feeds expose minimal data and revoke with access. Missed
scheduler runs produce catch up alerts without duplicates.

**Acceptance evidence:** An extension applicable only to one taxpayer
class changes only those open obligations. The audit trail shows both
dates. An obligation with an unknown form or category remains visible in
Review required. A bounced reminder never becomes evidence of client
receipt.

Preserve both income tax regimes: FY 2025--26 / AY 2026--27 uses the
1961 Act; Tax Year 2026--27 uses the 2025 Act. Filing date alone must
not choose the Act. Store law, assessment year and tax year
independently. \[S19\]

PRODUCT REQUIREMENTS / 15

# Document management and evidence custody

A file must retain its provenance, version, access scope and
professional context.

**DOC01 \| R0 \| Intake.** Accept permitted file types through the
portal or staff upload. Record source, uploader, practice, client,
engagement, period, received time and checklist link. Scan malware,
validate actual MIME type, limit size and decompression, quarantine
suspicious files and show actionable rejection reasons.

**DOC02 \| R0 \| Versioning.** Keep immutable originals with a
cryptographic hash. New uploads create new versions; compare metadata
and optionally content. Capture preparer, reviewer and status. Never
overwrite an approved original through an edit, OCR process, conversion
or integration retry.

**DOC03 \| R0 \| Classification and search.** Classify by document type,
period, entity and sensitivity. Search respects record and field
permissions before returning snippets, counts or suggestions. OCR and AI
classifications are draft metadata with source references and correction
history.

**DOC04 \| R0 \| Release and sharing.** Separate internal, client
supplied and approved client deliverable records. A reviewer releases an
exact version to named portal contacts. Links expire, require authorised
access and revoke on permission change. Internal audit working papers
are not automatically client deliverables. \[S11\]

**DOC05 \| R1 \| Physical register.** Track inward / outward movement,
originals, courier reference, custodian, storage location,
acknowledgment and return. Barcode or QR identification is optional. A
scanned copy and physical original retain their relationship and custody
history.

**DOC06 \| R0 \| Lock and retention.** Finalise a document set through a
manifest of versions and hashes. Apply retention schedule and legal
holds by record class. Deletion requires eligibility check, approval and
logged action; retained backups follow their own documented expiry and
restoration controls.

**Acceptance evidence:** Upload the same filename twice and preserve
both versions. Quarantine a malformed archive. Revoke a user and verify
their signed object link and search results no longer work. A client can
see the released report but cannot discover internal working paper
titles.

Redaction produces a derivative with a review record; visual black
rectangles alone do not prove sensitive content has been removed. Test
hidden text, metadata, attachments and OCR layers before external
release.

PRODUCT REQUIREMENTS / 16

# Communication and client requests

Messages should resolve work, with the correct practice identity and
verified recipient.

**COM01 \| R0 \| Unified context.** Attach portal messages, email
references, notes and approved meeting summaries to the client
relationship and engagement. Distinguish internal discussion from client
visible conversation. A user must not change a thread's visibility
without previewing all included content.

**COM02 \| R0 \| Structured requests.** Create itemised requests with
document type, period, due date, owner and response status. Clients may
submit, explain nonavailability or ask a question. A received file stops
that item's reminder only after the configured received / accepted rule;
one upload cannot close all requests.

**COM03 \| R0 \| Outbound safeguards.** Show sender practice, From /
Reply to identity, recipients, attachments and version before sending.
Verify changed external recipients separately. Templates contain no
client data until rendered within the authorised scope. Default to
secure portal links instead of sensitive email attachments.

**COM04 \| R0 \| Reminder engine.** Use per event and recipient
duplicate keys, quiet hours, digest options, retry limits and bounce
handling. Log Queued, Submitted, Delivered if confirmed, Failed,
Suppressed and Delivery uncertain separately. Provider acceptance is not
proof of reading or filing.

**COM05 \| R1 \| Meetings and calls.** Record meeting purpose,
participants, consent where needed, concise decisions, actions and
owners. AI transcription or summaries require approved processing.
Preserve original notes and human reviewed minutes; never invent
attendance, approval or commitments.

**COM06 \| R2 \| Optional channels.** Add official WhatsApp Business or
other approved messaging connectors only after terms, consent /
preference and template requirements are checked. Do not automate
consumer accounts or scrape inboxes. Channel outage must fall back to an
in app queue without disclosing extra data.

**Acceptance evidence:** Trigger the same reminder through two workers
and send one logical message. A client corrects an item and only that
request clears. A staff member switching practice cannot send a Company
invoice from an Associates identity.

Document request, professional advice, fee reminder and promotional
content have different purposes. This PRD covers service communications;
any future marketing needs a separately reviewed policy.

PRODUCT REQUIREMENTS / 17

# Client portal and external collaboration

The client should find the next required action without seeing the
internal practice system.

**POR01 \| R0 \| Portal home.** Show the identified practice, authorised
client entities, pending requests, upcoming agreed dates, released
deliverables and issued invoices. Provide a clear "Upload requested
documents" action and a short help link. Do not expose internal staff
productivity, working papers or discussion.

**POR02 \| R0 \| Contact authority.** Invite a named contact with
client, practice and authority scope. Support a CFO acting for several
entities through explicit grants and a visible entity switcher.
Invitations are single use and expiring; public self registration cannot
discover existing client accounts.

**POR03 \| R0 \| Upload experience.** Guide the user by service and
period; allow multiple files, resumable upload and receipt confirmation.
Show each item's Received, Needs correction or Accepted state. The
receipt confirms intake only, not correctness or completion of the
audit.

**POR04 \| R1 \| Approvals.** Show exact document version, purpose and
consequence when requesting client approval. Require authenticated
acceptance evidence appropriate to the action. Clicking "Reviewed" is
not a substitute for a legally required signature, DSC or government
verification.

**POR05 \| R0 \| Accessibility and support.** Offer mobile responsive
screens, readable file labels and clear recovery for expired links,
missing permissions and interrupted uploads. Do not demand a desktop
app. Provide a call / message route using verified firm contact details
configured by the owner.

**POR06 \| R1 \| External experts.** Create time limited guest review
areas for lawyers, specialists, external quality reviewers or other
advisers. Permit only selected records; display access expiry and export
restrictions. Guests cannot forward access by inviting more people.

**Acceptance evidence:** A group CFO switches between two approved
client entities and cannot see a third. An expired invitation gives a
safe renewal request without identifying the client to an
unauthenticated visitor. Interrupted upload resumes without duplicate
originals.

Separate portal authentication from internal staff administration.
Client facing notifications must say which practice is providing the
service. Avoid showing "all BHV clients" lists or aggregate firm metrics
on shared portal routes.

PRODUCT REQUIREMENTS / 18

# Income tax and tax audit practice pack

Manage obligations and evidence across periods, with the reviewing CA
controlling interpretation.

**TAX01 \| R1 \| Period and regime.** Store financial year, assessment
year where relevant, tax year where relevant, governing Act, form
version and taxpayer category independently. Keep older proceedings and
current tax years active together. Migrate form labels only by approved
mapping; preserve historical references. \[S19\]

**TAX02 \| R1 \| Return workflow.** Cover intake, books / AIS / TIS /
Form 26AS reconciliation as applicable, computation preparation, query
resolution, review, client approval, tax payment evidence, filing and
verification / acknowledgment. Import only authorised files or supported
integrations; a status cannot imply portal verification.

**TAX03 \| R1 \| Tax audit workflow.** Use a CA approved clause
checklist with data source, response, evidence, exception, preparer and
reviewer. Link financial statements and relevant reconciliations. Keep
3CA / 3CB / 3CD and successor forms tied to their applicable period
instead of one permanent form assumption.

**TAX04 \| R1 \| Review and representations.** Capture management
explanations and representations with signatories, dates and deviations.
Unresolved exceptions remain in the reviewer queue. Receipt of a
representation is not verification of an assertion or a substitute for
appropriate evidence. \[S20\]

**TAX05 \| R1 \| Filing lifecycle.** Track original, revised, corrected
or withdrawn submissions distinctly; store government reference, filed
file hash, acknowledgment, authorising person and dates. Rejection
reopens a remediation job without erasing the attempted submission.
Track UDIN linkage separately where applicable.

**TAX06 \| R1 \| Related work.** Support advance tax, TDS credit
mismatch, refund follow up, rectification, reassessment and appeal
engagements through templates. Do not silently extend the original
engagement scope. A tax calculator or return engine is an optional
verified integration, not assumed core capability.

**Acceptance evidence:** Process an earlier year return filed after a
new Act commencement and retain the correct old regime. A tax audit
report cannot reach Issued while required review exceptions remain
unresolved or a documented authorised decision is absent.

All statutory dates and form requirements originate in the approved
obligation register. No hardcoded tax rates, thresholds or universal
"tax audit deadline" should be spread across UI code, emails and service
templates.

PRODUCT REQUIREMENTS / 19

# GST, TDS and recurring compliance

Period based work should be repeatable, explainable and supported by
reconciliation evidence.

**GST01 \| R1 \| Registration scope.** Create obligations per client GST
registration and period, with scheme, filing frequency and effective
dates. A single client can have several states, registrations or changes
during a year. Preserve cancelled registrations and their residual
obligations.

**GST02 \| R1 \| GST preparation.** Support GSTR 1, GSTR 3B, annual
return / reconciliation and related work through configurable templates.
Track source receipt, sales and purchase reconciliation, credit review,
liability approval, payment evidence, filing and acknowledgment; never
mark filed from a draft upload.

**GST03 \| R1 \| Reconciliation controls.** Keep original books and
portal extracts, source period, version and reconciliation rules.
Classify exact, probable and unmatched records. A human reviews
differences, amendments, timing issues and credits before a final
output. A match score alone does not establish tax eligibility.

**GST04 \| R1 \| TDS and TCS.** Track TAN, quarter, statement type,
challans, deductee corrections, defaults, certificate delivery and
revised submissions. Preserve original and corrected versions and
outstanding demands. Include responsible reviewer and delivery evidence
for client outputs.

**GST05 \| R2 \| Portal connectors.** Use documented authorised API /
GSP channels where available, with taxpayer consent and scoped tokens.
OTP or CAPTCHA belongs in an entitled human interaction, not a reusable
bypass. If API access is unavailable, retain controlled file import and
manual acknowledgment capture. \[S23\]

**GST06 \| R1 \| Errors and state changes.** A corrected source extract
creates a new reconciliation version. A filed period is locked against
silent modification; subsequent amendments link back to the original.
Notification preferences and document reminders apply per registration
and period.

**Acceptance evidence:** Generate quarterly and monthly obligations for
different registrations of the same client. Import a revised extract
without doubling turnover. An apparent invoice match remains pending
until the reviewer confirms the relevant treatment.

The practice manager coordinates the work and evidence. It does not
replace the GST portal, professional tax determination or a validated
filing product. e Invoice / e Way Bill integrations require a separately
approved scope and interface.

PRODUCT REQUIREMENTS / 20

# Corporate law and entity secretarial work

Event based compliance needs a record of the triggering fact, not only a
recurring calendar date.

**COR01 \| R1 \| Entity profile.** Maintain CIN / LLPIN where
applicable, registered office, directors / partners, authorised
contacts, financial year, capital structure references and change
history. Sensitive identifiers use field permissions. Do not treat an
MCA search result as authority to act for the entity.

**COR02 \| R1 \| Recurring and event work.** Provide templates for
annual filings, meetings, changes in directors / partners, registered
office changes, allotments, charges and LLP obligations. A triggering
event has verified date, source and responsible reviewer; statutory
timelines derive from the approved rule.

**COR03 \| R1 \| Document assembly.** Generate notices, agendas, draft
minutes, resolutions and registers from approved templates. Clearly
label drafts. Record who actually convened, attended, approved and
signed; never infer that a meeting occurred because a draft was
generated.

**COR04 \| R1 \| Authorisation and filing.** Track board / member
approvals, attachments, professional certification where required,
authorised signatory and filing reference. Confirm the eligible
professional and statutory conditions before submission. A stored DSC
token assignment is not legal signing authority.

**COR05 \| R1 \| Change and rejection.** Maintain resubmission,
additional fee, rejection and correction workflows with reasons and
deadlines. A changed attachment invalidates its earlier approval.
Preserve filed versions and communication evidence rather than replacing
them with the latest draft.

**COR06 \| R1 \| Specialist collaboration.** Assign work requiring a
company secretary, lawyer, valuer or other specialist to an
appropriately engaged person. Record scope and reliance. The tool must
not imply that a CA can perform every legal or certification role merely
because a template exists.

**Acceptance evidence:** Create an event based job from a verified
appointment date. Change the date with a reason and show the resulting
deadline impact for review. Reject filing approval when the signing
authority record has expired.

Service packs are jurisdiction and entity specific. Initial coverage is
India; foreign entities and cross border advisory remain separately
scoped templates with their own authoritative rules.

PRODUCT REQUIREMENTS / 21

# Audit planning, risk and engagement quality

Audit workflows support professional judgment; they do not generate an
assurance conclusion by themselves.

**AUD01 \| R1 \| Standards profile.** Assign audit type, reporting
framework, applicable SAs and quality framework at engagement inception.
Link approved methodology versions. Cover statutory, tax and internal
audit with distinct templates; do not apply statutory audit opinion
logic automatically to advisory or internal audit jobs.

**AUD02 \| R1 \| Acceptance and strategy.** Record engagement terms,
independence, competence, resources, predecessor communication where
applicable, team discussion and planned scope. Capture planning
materiality, performance materiality and thresholds with basis,
preparer, reviewer and later revisions. The software cannot pick
universal percentages.

**AUD03 \| R1 \| Risk assessment.** Maintain significant risks, fraud
considerations, process / control understanding and assertions. Link
each planned response and procedure to the relevant risk. Track changes
and contradictory evidence. The methodology should map SA 240, SA 300,
SA 315 and SA 330 as applicable, with current authoritative versions
reviewed by the CA.

**AUD04 \| R1 \| Workpaper programme.** Each workpaper records
objective, population, procedure, sample selection basis, items tested,
evidence, exceptions, conclusion, preparer and reviewer. Link external
confirmations, estimates, related parties, subsequent events and going
concern work to their relevant methodology; retain alternative
procedures when required.

**AUD05 \| R1 \| Quality review.** Maintain consultations, differences
of opinion, reviewer eligibility, engagement quality review where
applicable and release blocks. SQC 1 remains the configured baseline
pending further ICAI announcement; SQM readiness can be enabled
prospectively without falsely labelling it mandatory. \[S12\]\[S14\]

**AUD06 \| R1 \| Evidence control.** Separate client representations,
external evidence, system outputs and auditor analysis. A management
upload does not become independent evidence by classification.
Unresolved findings and contradictory evidence must reach the reviewer;
AI may suggest, not clear, risks.

**Acceptance evidence:** A significant risk with no linked response
prevents planning approval. A changed materiality basis flags affected
procedures for review. A small practice setting cannot bypass a required
eligible quality reviewer.

Reference standards include SA 210, SA 220, SA 230, SA 500, SA 505, SA
520, SA 530, SA 540, SA 550, SA 560, SA 570 and SA 580 where applicable.
This list is a methodology coverage target, not a substitute for reading
the currently applicable text.

PRODUCT REQUIREMENTS / 22

# Audit completion, reporting and file assembly

The final report, its evidence and subsequent amendments must remain
traceable.

**AUD07 \| R1 \| Completion checklist.** Review uncorrected
misstatements, disclosure issues, subsequent events, going concern,
representations, communications with management / those charged with
governance, and outstanding findings. Record each unresolved matter and
the signing partner's conclusion rather than silently clearing it.

**AUD08 \| R1 \| Representations.** Capture required clauses,
responsible and knowledgeable management signatories, dates, deviations
and authentication evidence. Flag representations dated after the
auditor's report or missing relevant periods. A received letter is
necessary evidence where required, but not sufficient on its own.
\[S20\]

**AUD09 \| R1 \| Reporting decision.** Support reviewed drafts under
applicable reporting standards, including SA 700, SA 705 and SA 706
where relevant. Record modification considerations and consultations.
Only an eligible authorised CA approves and signs. The app must not
automatically select an opinion, assert a clean report or alter signed
language.

**AUD10 \| R1 \| Assembly and lock.** SA 230 describes ordinarily
completing assembly within 60 days after the auditor's report date.
Store any later group report date separately for retention. Freeze a
final manifest of file versions. Distinguish administrative assembly
from new procedures or changed conclusions. \[S11\]

**AUD11 \| R1 \| Retention and amendments.** SA 230 ordinarily requires
retention no shorter than seven years from the report or later group
report. Apply a reviewed record schedule and any longer obligation or
legal hold. Post assembly changes preserve originals, reason, author,
date and reviewer. No automatic blanket seven year deletion. \[S11\]

**AUD12 \| R1 \| Inspection package.** Export a scoped review package
containing approved reports, methodology version, workpaper index,
evidence references, review history and amendment log. Allow time
limited external quality / peer review access. Exclude unrelated
engagements, secrets and personal records.

**Acceptance evidence:** Issue a fictional report, assemble its file and
attempt to overwrite a signed workpaper. The write fails or creates a
visible authorised amendment. A missing management representation
escalates for professional reporting assessment; it never automatically
produces an opinion.

Working papers are distinct from client owned source records and
approved deliverables. The portal release policy must preserve that
distinction, subject to professional obligations and appropriate lawful
access requests.

PRODUCT REQUIREMENTS / 23

# Notices, litigation and certificates

High consequence deadlines and signed outputs need their own controlled
registers.

**LIT01 \| R1 \| Notice register.** Capture authority, statute / section
version, client, practice, period, notice type, reference / DIN where
applicable, issue date, service date, response deadline, hearing date,
exposure estimate and owner. Preserve the received original and
verification evidence; OCR fields require review.

**LIT02 \| R1 \| Matter workflow.** Link chronology, facts, issues,
submissions, supporting documents, precedents, counsel, authorisations,
hearings and orders. Separate draft advice from filed submissions.
Record adjournment requests and granted orders distinctly; requesting an
extension does not change the legal deadline.

**LIT03 \| R1 \| Escalation and closure.** Escalate unassigned notices
and imminent response dates. Track acknowledgements, resubmissions,
appeal limitation review and residual actions after an order. Close with
a reviewed outcome, not merely a calendar event marked complete.

**CERT01 \| R1 \| Certificate preparation.** Record purpose, intended
recipient, governing guidance, scope, criteria, basis, source evidence,
calculations, limitations and signatory. Produce a draft preview and
evidence index. No universal materiality tolerance, generic "ICAI
format" assurance or automatic issue command. \[I05\]

**CERT02 \| R1 \| Issue and UDIN.** Record signed version hash, member,
FRN where applicable, signature date, document category, UDIN,
generation date and supporting evidence. Distinguish document signing,
UDIN generation and regulator linkage. The general 60 day generation
rule is configurable and reverified; a historical relaxation is not a
permanent extension. \[S18\]

**CERT03 \| R1 \| Correction and revocation.** Revised certificates or
reports retain links to the earlier issue and reasons. Record required
client communication, portal actions and revocation status where
applicable. The app records official actions; it does not invent UDINs
or assume an unrestricted generation API.

**Acceptance evidence:** A hearing adjournment request leaves the
original hearing date active until the order is recorded. Editing a
certificate's amount invalidates approval. UDIN reminder completion
requires a recorded valid workflow outcome, not just a dismissed alert.

Litigation assistance can include research and draft organisation.
Advice, arguments, limitation interpretation and representation
authority remain with the responsible professional.

PRODUCT REQUIREMENTS / 24

# Accounting, advisory and specialist practices

Use the common engagement and evidence model; enable specialist depth
only where the practice provides it.

**ACC01 \| R1 \| Bookkeeping workflow.** Manage period close, bank
reconciliation, receivable / payable review, ledger queries, inventory
inputs, payroll inputs and financial statement preparation. Keep source
books separate from practice billing. Proposed entries require client /
authorised accountant approval before posting.

**ACC02 \| R1 \| Reconciliation.** Preserve source files, versions,
totals and match rules. Separate exact matches, suggested matches,
timing differences and unresolved items. Capture the reviewer's decision
and any resulting proposed adjustment. Reprocessing must not duplicate
approved entries. \[I09\]

**ADV01 \| R1 \| Advisory templates.** Support management consultancy,
MIS, cash flow, budgets, project finance, due diligence and business
planning through scoped templates. Every model records assumptions,
units, currency, source dates, scenarios and reviewer. Estimates must
not be presented as guaranteed outcomes.

**ADV02 \| R2 \| Specialist packs.** Provide extension points for
forensic / investigation work, bank and concurrent audit, trust / NGO
work, FEMA / international tax, transfer pricing, insolvency support,
family enterprise advisory, valuation coordination and sector specific
compliance. Activate only with verified competence and appropriate
authority.

**ADV03 \| R1 \| Evidence and conflicts.** Specialist matters use
separate sensitivity classifications and engagement walls. Preserve
chain of custody where investigation work requires it. Assess conflicts
with assurance work and potential self review. Client group
relationships may be modelled without granting every group contact
access.

**ADV04 \| R2 \| Model and analytics handoff.** Import or link approved
Excel models and analytics outputs with version, input manifest and
calculation checks. Keep deterministic computation separate from AI
commentary. Exports must carry scope, assumptions and limitations, with
professional review before release.

**Acceptance evidence:** Import a changed trial balance and show that
the financial statement draft is stale. A proposed ledger entry cannot
post automatically. A forensic engagement's restricted documents do not
appear in ordinary client search or consolidated management snippets.

A generic module is not a substitute for specialist methodology,
qualification or reporting authority. Dedicated financial statement,
valuation or forensic engines require separate specifications and
validation before integration.

PRODUCT REQUIREMENTS / 25

# Fees, invoicing and collections

Practice billing must remain accurate, separately owned and reconciled
to actual accounting records.

**FIN01 \| R0 \| Fee arrangements.** Support fixed, recurring, milestone
and time based fees, reimbursable expenses, advances and scope changes.
Tie charges to the engagement and owning practice. Store agreed tax
treatment, currency, effective rate and approval; never infer rates from
a staff timer alone.

**FIN02 \| R0 \| Invoice identity.** Provide separate financial year
series per practice / registration and approved numbering policy.
Generate Draft, Approved, Issued, Part paid, Paid, Credited and
Cancelled states. Issued particulars are locked; corrections use
reviewed credit / debit notes or permitted amendment workflows.

**FIN03 \| R1 \| Tax particulars.** Configure supplier and customer
identifiers, place of supply, SAC / classification, taxable value,
taxes, reverse charge indicators and mandatory particulars as
applicable. An absent GSTIN or state code alone cannot determine tax
treatment. e Invoice requirements are versioned and professionally
reviewed.

**FIN04 \| R0 \| Receipts and allocations.** Record receipts against the
correct bank account and invoice, including part payments, advances,
deductions / TDS credits, refunds and write offs. Separate cash received
from tax deducted and credit notes. Prevent over allocation and preserve
reconciliation adjustments.

**FIN05 \| R1 \| Collections and controls.** Provide ageing by due date,
disputed balances, promise to pay and approved reminder templates. Show
invoice practice and client. Do not automatically withhold client
records or statutory deliverables because fees remain unpaid; require a
professionally reviewed release policy.

**FIN06 \| R1 \| Accounting bridge.** Export approved invoices and
receipt allocations to the designated accounting system with batch ID
and reconciliation totals. Track accepted, rejected and retried records.
Changes in the accounting system return as reviewed reconciliation
items, not silent overwrites.

**Acceptance evidence:** Create identical invoice sequence numbers in
separate permitted practice series without collision. Allocate a part
payment and TDS deduction; cash, credited tax and balance remain
distinct. A rejected Tally export can retry without a duplicate voucher.

The R0 billing register is not a complete general ledger or statutory
tax engine. The approved accounting system remains the source of truth
for books unless a separately specified accounting module replaces it.

PRODUCT REQUIREMENTS / 26

# People, time and capacity

Measure work to plan and improve delivery, with clear boundaries around
employee privacy.

**HR01 \| R1 \| People records.** Maintain employment / article /
consultant status, practice memberships, reporting lines, skills,
training, availability and joining / leaving dates. Restrict
compensation, identity documents and disciplinary records to authorised
HR roles. Article training requirements remain configurable and
professionally reviewed.

**HR02 \| R1 \| Attendance and leave.** Support calendar based
attendance, leave requests, approvals and holiday calendars where
needed. Show capacity impact without disclosing medical details. Do not
include covert webcam use, keystroke capture or screenshots in the
baseline product.

**TIM01 \| R1 \| Time entry.** Allow timer and manual entry against
practice, engagement, task and work type. Prevent concurrent active
timers by default. Capture breaks, nonbillable work, approval status and
correction reason. Use integer minutes or a defined decimal precision
consistently.

**TIM02 \| R1 \| Approval and lock.** Managers review timesheets before
billing or reporting. Lock approved billed periods; corrections create a
visible adjustment with permission and reason. Billing snapshots retain
historical rates even when current staff rates change.

**RES01 \| R1 \| Resource planning.** Show available capacity net of
approved leave, planned assignments, skill requirements, review capacity
and conflicts. Reallocation previews due date and workload impact. A
capacity recommendation does not silently change engagement ownership or
permissions.

**RES02 \| R1 \| Profitability.** Report approved time cost, agreed
fees, billed revenue and collections as separate measures. Label WIP
valuation assumptions. Combined practice reporting allocates shared
staff once using explicit rules and displays the included scope; it is
not consolidated statutory financial statements.

**Acceptance evidence:** Reassign work from a leaving article and
preserve their recorded time and authorship. A manager can view
availability without salary data. A historical invoice remains unchanged
after the employee's cost rate changes.

Payroll processing and statutory labour filings are optional
integrations. The core can retain approved payroll summaries and
compliance jobs without building a payroll engine.

PRODUCT REQUIREMENTS / 27

# Internal administration, assets and AI spending

Manage the practice's own resources separately from client engagements
and statutory records.

**OPS01 \| R1 \| Assets and custody.** Track computers, AI hardware,
monitors, licences, token devices and other assets by owning practice,
custodian, purchase, location, warranty, maintenance and disposal.
Separate ownership from shared usage allocation. Data wiping and return
evidence are required on reassignment / disposal.

**OPS02 \| R1 \| Subscriptions and budgets.** Incorporate the earlier AI
Spend Tracker pattern: provider, plan, seats, cycle cost, currency,
estimated INR, actual payments, renewal, cancellation deadline, payment
method, owner and budget. Monthly equivalents are comparison measures;
actual cash payments drive cash budget reports.

**OPS03 \| R1 \| Procurement and expenses.** Support request, budget
check, approval, purchase evidence, allocation and reimbursement. Shared
costs require an approved basis. No automatic payment execution. Mask
card references and keep credentials outside the expense record.

**OPS04 \| R1 \| Registrations and renewals.** Maintain firm and member
registrations, insurance, subscriptions, domain / certificate renewal
and contractual renewals with source documents and responsible persons.
Distinguish expiry, renewal action and evidence of completed renewal.

**OPS05 \| R1 \| Office registers.** Offer correspondence inward /
outward, visitor or equipment movement where justified, office policies,
vendor contacts and administrative tasks. Keep these optional so the
daily work menu remains short. Do not collect personal data without an
operational purpose.

**OPS06 \| R1 \| Training and media approvals.** Store approved staff
assignments, tutorials and AI avatar / communication assets with
consent, usage purpose, source, version and release approval. The Task
01 avatar exercise can be a synthetic training example; no public
release follows automatically from completion.

**Acceptance evidence:** An annual software payment appears once in
actual cash spending and separately as a monthly equivalent. A shared AI
workstation has one owner and an explicit allocation. A cancellation
reminder is not marked complete by a payment entry.

Asset purchase cost, tax depreciation, book depreciation and management
usage allocation are distinct concepts. The practice manager may link
approved accounting records rather than calculate every statutory
treatment.

PRODUCT REQUIREMENTS / 28

# Knowledge, templates and the Practice menu

The product should teach the firm's approved way of working at the point
of use.

**KNW01 \| R0 \| Practice menu.** Provide Service playbooks, My
learning, Templates, Sample practice, User manual, Policy library and
Help search. Show only relevant items by role and enabled services. The
Practice menu means guided work and learning, not another copy of the
task list.

**KNW02 \| R0 \| Manual structure.** Each screen has contextual help
covering purpose, prerequisites, fields, steps, permissions, common
errors and related SOPs. Articles carry owner, version, effective date
and review date. Search ranks the current article but preserves archived
versions for historical work.

**KNW03 \| R1 \| Template governance.** Store firm approved checklists,
letters, workpapers and reports with source basis, scope and signoff.
Draft changes require review and a version diff. Jobs retain their
original template version; bulk upgrades require preview and explicit
approval.

**KNW04 \| R0 \| Sample practice.** Create a separate training tenant /
database with synthetic clients and unmistakable DEMO labels. Disable
live email, filings, payments, production credentials and external
client links. Reset training data without touching production or its
backups.

**KNW05 \| R1 \| Learning records.** Offer role journeys for articles,
managers, finance, partners and clients; include short walkthroughs and
practical exercises. Record completion only when relevant, with an
option for supervisor review. Training quizzes do not grant production
signoff authority.

**KNW06 \| R1 \| Knowledge permissions.** Separate public professional
references, internal policy and client specific material. Keep
confidential case notes in engagement scope. A knowledge search or AI
answer must not combine restricted client material into a general
handbook.

**Acceptance evidence:** From a rejected document upload, open the
relevant recovery guide directly. Reset the demo practice and confirm
production counts are unchanged. An old engagement retains its approved
checklist after the general template is updated.

Provide a readable downloadable manual and in app version built from the
same maintained content. Menu labels, screenshots and examples must be
updated as part of each release, rather than supplied once at
installation.

PRODUCT REQUIREMENTS / 29

# AI assistance and human decision boundaries

AI is optional. Core work, deadlines, permissions and records must
function when AI is disabled.

**AI01 \| R2 \| Allowed assistance.** Enable document classification,
source linked extraction, client request drafts, meeting summaries, work
status summaries and approved knowledge Q&A. Every output is labelled
Draft / AI assisted until reviewed. Do not claim a single universal
accuracy percentage.

**AI02 \| R2 \| Data routing.** Route confidential inference to an
approved local service by default. Cloud use requires an explicit
practice policy, permitted data class and logged user approval for the
job where required. Masking is not proof of anonymisation. Record
destination, purpose and categories transmitted.

**AI03 \| R2 \| Retrieval permissions.** Filter candidate sources by
current tenant, practice, engagement and document permissions before
retrieval and again before answer release. Partition indexes and caches
accordingly. Revocation must remove future retrieval access; stale
embeddings are not a permission exception.

**AI04 \| R2 \| Authority limits.** AI cannot change legal dates,
approve invoices, post accounting entries, transmit client messages,
file forms, sign reports, issue certificates or move funds. It may
propose structured actions that require the same server permission and
human approval as manual actions.

**AI05 \| R2 \| Evidence and uncertainty.** Return cited document,
version and page / field for factual claims; show missing evidence or
conflicting sources. Extraction presents original content beside
proposed fields. Critical identifiers, amounts and dates require human
verification before downstream use.

**AI06 \| R2 \| Safe operation.** Treat uploaded documents and retrieved
content as untrusted instructions. Protect against prompt injection,
malicious files, secret extraction and unauthorised tool calls. Set time
/ token budgets, cancellation, circuit breakers and per practice cost
limits. Do not train on client data by default.

**Acceptance evidence:** Insert a document instruction to send all
client files externally; the system ignores it and logs the security
event. A revoked user cannot retrieve prior cached excerpts. Disabling
AI leaves task creation, search, billing and deadline processing
operational.

The existing AI hardware is a candidate inference host, not a proven
capacity commitment. Benchmark model licence, memory, concurrency, OCR
and response quality on representative permitted data before choosing
the runtime.

PRODUCT REQUIREMENTS / 30

# AI evaluation and source processing

Approve AI features by task and risk, using reproducible evaluation
rather than demonstration quality.

  ------------------------------------------------------------------------
  **Feature**      **Input and output contract**    **Human checkpoint**
  ---------------- -------------------------------- ----------------------
  Document         Permitted original and version → Verify PAN / GSTIN,
  extraction       proposed fields, confidence,     amounts, dates, bank
                   page references and validation   details and every
                   errors.                          field used in a
                                                    consequential output.

  Knowledge Q&A    Authorised query and approved    Professional reviews
                   sources → answer with source     legal interpretation
                   version and missing evidence.    and current
                                                    applicability.

  Work summary     Scoped jobs and event history →  Owner verifies before
                   factual status, blockers and     sending outside the
                   suggested next actions.          team.

  Draft            Approved template and permitted  Authorised person
  communication    facts → draft text and recipient confirms recipient,
                   suggestion.                      practice, attachments
                                                    and wording.
  ------------------------------------------------------------------------

**AIE01 \| R2 \| Evaluation set.** Build a consented or synthetic
benchmark with clean scans, poor scans, handwriting where supported,
mixed language, multiple entities, amendments and adversarial text. Keep
a held out set and record model, prompt, parser and rule versions. Do
not use production client data for employee experiments.

**AIE02 \| R2 \| Measures.** Report exact field match for critical
extraction, precision / recall for classification, source citation
correctness, unsupported claim rate and permission leakage separately.
Denominators, sample sizes and error categories must be visible. A low
confidence label cannot excuse an incorrect accepted field.

**AIE03 \| R2 \| Release gates.** No cross practice / tenant leakage in
the adversarial acceptance set; no autonomous external action; all
accepted critical fields verified. Set task specific quality targets
after a baseline study and owner approval. A model update must pass
regression checks before production promotion.

**AIE04 \| R2 \| Traceability and deletion.** Record job ID, permitted
source IDs, model / prompt version, reviewer corrections, result and
processing destination. Store only necessary prompt content under the
record retention policy. Deletion / access revocation propagates to
derivatives, indexes and caches with an observable reconciliation
report.

**Acceptance evidence:** Compare two model versions on the same frozen
dataset and explain each material regression. A source document deleted
under an approved policy disappears from future retrieval while the
required minimal audit event remains.

Proposed pipeline: authorise source → scan and classify → OCR / extract
→ deterministic validation → reviewer correction → approved structured
data. AI never owns the authoritative legal rule, identity grant or
financial ledger.

PRODUCT REQUIREMENTS / 31

# Integration catalogue and boundaries

Every connector has a defined source of truth, permission scope, owner
and failure path.

  ------------------------------------------------------------------------
  **Connector**   **Initial mode /            **Authority and recovery**
                  direction**                 
  --------------- --------------------------- ----------------------------
  Excel / CSV     R0 controlled import and    Preview mappings and
                  export.                     rejects; batch ID, totals,
                                              rollback before activation.

  Email /         R0 approved outbound; R1    OAuth / delegated scope;
  calendar        selected mailbox and        verified sender practice;
                  calendar sync.              duplicate keys and bounce
                                              handling.

  TallyPrime      R1 export of approved       Documented XML / HTTP or
                  practice billing; R2        supported interfaces;
                  authorised read / write     company mapping, local
                  adapters.                   gateway and voucher
                                              reconciliation. \[S24\]

  GST systems     R2 authorised API / GSP;    Consent, provider contract
                  otherwise manual files.     and exact capability proof;
                                              no implied universal filing
                                              API. \[S23\]

  Income tax /    R0 portal links and         Human authentication and
  MCA / UDIN      evidence upload; later      entitlement; do not bypass
                  approved interfaces.        CAPTCHA or store OTPs.

  Payments / e    R2 approved provider.       Verify webhooks and legal
  signature                                   suitability. A webhook alone
                                              cannot allocate ambiguous
                                              receipts or approve a
                                              report.

  Storage / local R0 storage abstraction; R2  Versioned objects,
  AI              approved AI endpoint.       encryption and access scope;
                                              health / queue status
                                              visible.

  WhatsApp / SMS  R2 official business        Approved purpose and
                  interface only.             recipients; minimum content;
                                              provider restrictions apply.
  ------------------------------------------------------------------------

**INT01 \| R0 \| Connector configuration.** Store practice, owner,
purpose, environment, scope, provider, credential reference and status.
Test connections without disclosing secrets. Development and production
credentials are separate; rotating one practice's token cannot disrupt
the other practice.

**INT02 \| R1 \| Reliable synchronisation.** Use stable external IDs,
idempotency keys, checkpoints, bounded retry and a dead letter queue.
Show errors to an assigned operator. A callback is authenticated, replay
protected and reconciled before it changes authoritative status.

**Acceptance evidence:** Simulate a timeout after the external system
accepted an invoice. Retry resolves the existing external reference
rather than creating another invoice. If an interface is unavailable,
the UI offers the approved file based or manual workflow.

Connector availability and commercial costs must be verified during
technical discovery. The PRD does not claim that every government portal
offers a public API or that another product's integration licence
transfers to BHV.

PRODUCT REQUIREMENTS / 32

# System architecture and data flow

Use a transactional core with explicit processing boundaries and an
observable queue.

  -----------------------------------------------------------------------
  **Component**   **Responsibility**         **Data location / boundary**
  --------------- -------------------------- ----------------------------
  Web and mobile  Authenticated screens,     No enduring sensitive
  browser         responsive portal and UI   offline cache by default;
                  validation.                sessions in secure cookies.

  Application /   Authorisation, workflow    Firm controlled runtime; all
  API             transitions, validations   operations scoped by tenant
                  and audit events.          and practice.

  Relational      Client relationships,      Primary approved hosting
  database        jobs, rules, invoices,     environment; encrypted
                  permissions and metadata.  storage and restricted
                                             service identity.

  Object storage  Originals, versions,       Separate scoped namespaces
                  deliverables and final     with versioning, encryption
                  manifests.                 and retention controls.

  Worker /        Reminders, imports, OCR,   Durable queue; retries and
  scheduler       exports and connector      failures visible in the app.
                  reconciliation.            

  Search / AI     Authorised search indexes  Scope aware indexes; local
                  and optional inference.    inference preferred for
                                             confidential material.

  Messaging       Approved external          Minimum necessary content
  providers       notification delivery.     leaves the core; provider
                                             and destination logged.
  -----------------------------------------------------------------------

## Authoritative transaction flow

A user action reaches the API; the API checks identity, practice and
record authority; validates the requested state transition; then commits
the business change and an outbox event in one database transaction. A
worker delivers the external side effect from the outbox. Retries use
the same logical action key. The UI shows Pending until the outcome is
known.

## Deployment and remote use

For firm hosted deployment, staff on the LAN can use the core when the
internet is unavailable, provided local identity and infrastructure are
healthy. Remote access uses an approved secure gateway / VPN. A public
client portal requires a hardened HTTPS edge, monitoring and protected
connection to the core; do not expose database or Tally ports directly.

Full bidirectional offline editing is excluded from the initial release.
Optional offline time entry later needs encrypted device storage,
limited data, conflict handling and revocation rules. The application
must display degraded mode instead of claiming that cloud email or
portal filings are available offline.

PRODUCT REQUIREMENTS / 33

# Core data model and record dictionary

Use stable identifiers and typed relationships. Do not encode business
meaning only in filenames or free text.

  -----------------------------------------------------------------------
  **Record**          **Required relationships and fields**
  ------------------- ---------------------------------------------------
  Practice /          Tenant ID; practice ID; constitution; verified
  membership          identifier holder; effective dates; user; role;
                      branch / team; grants and expiry.

  Party / client      Party ID; legal name; type; verified identifiers;
  relationship        practice relationship ID; contact authority;
                      acceptance and confidentiality classification.

  Engagement / job /  Practice and client relationship; service and
  task                template version; period; owner / reviewer; state;
                      obligations; dependencies and version counter.

  Obligation / rule   Rule version; source; applicability; original and
                      current statutory dates; internal targets; approval
                      and change history.

  Document / version  Practice; engagement; source; storage object ID;
                      hash; MIME; size; classification; preparer /
                      reviewer; release grant; retention / hold.

  Invoice / receipt   Practice / registration; series and fiscal period;
                      client; lines; currency; tax rule version;
                      approvals; immutable issued snapshot; allocations.

  Approval / filing   Exact subject version; actor; authority; decision;
                      timestamp; comments; source file hash; external
                      reference and acknowledgment.

  Event / integration Tenant / practice; actor or service identity;
  / AI job            target ID; action / correlation ID; before / after
                      metadata; rule / model version; result and error.
  -----------------------------------------------------------------------

**DAT01 \| R0 \| Types and invariants.** Use fixed precision decimals
for money, explicit currency and defined rounding. Store UTC timestamps
plus relevant jurisdiction timezone; statutory date only values remain
dates. Required foreign keys and practice consistency constraints must
reject orphaned or cross scoped references.

**DAT02 \| R0 \| Historical snapshots.** Signed reports, issued
invoices, filed forms and accepted engagements retain their particulars
at issue time. Current master data may change without rewriting history.
Store effective intervals for roles, rates, templates and legal rules.

**DAT03 \| R0 \| Reversible administration.** Use archive / deactivate
for ordinary removal. Destructive purge is a separate retention
controlled process. Soft deletion alone is not erasure; restoration must
reapply current permissions, holds and deletion decisions.

**Acceptance evidence:** A Company invoice cannot reference an
Associates engagement. Changing a contact name does not alter the
previously issued invoice PDF. A deleted user remains identifiable in
historical approvals without retaining unnecessary account secrets.

PRODUCT REQUIREMENTS / 34

# API contracts, events and concurrent work

An engineer should implement user intentions as controlled commands, not
unrestricted table updates.

  -----------------------------------------------------------------------
  **Command /      **Minimum contract**         **Failure rule**
  event**                                       
  ---------------- ---------------------------- -------------------------
  Create           Client relationship,         Reject conflicting
  engagement       practice, service, period,   practice or missing
                   owner and expected template  acceptance preconditions.
                   version.                     

  Approve document Document version, hash,      Reject self approval
                   reviewer and expected record where prohibited, stale
                   version.                     version or missing
                                                evidence.

  Record filing    Obligation, approved file    Keep Pending evidence if
                   hash, external reference,    acknowledgement is
                   date and evidence.           missing; never fabricate
                                                Filed.

  Send request     Practice sender, verified    No duplicate logical
                   contacts, template version,  send; uncertain delivery
                   item IDs and action key.     is visible.

  Issue invoice    Approved draft version,      Reserve number
                   registration and series.     transactionally; retry
                                                returns the same issued
                                                record.

  Grant access     Grantee, practice / record   No grant broader than the
                   scope, action set, expiry    grantor's authority;
                   and approver.                conflicts override.
  -----------------------------------------------------------------------

**API01 \| R0 \| Common controls.** All endpoints authenticate,
authorise and validate input server side. Resolve requested records
within tenant and practice scope. Use consistent error codes with safe
human messages and a correlation ID; do not reveal whether an
inaccessible client exists.

**API02 \| R0 \| Concurrency.** Use optimistic version checks for drafts
and configuration. If another user changes the record, present a
comparison and reload / merge option; never silently last write wins for
approvals, deadlines, allocations or signed material.

**API03 \| R0 \| Event reliability.** Commit important business events
with the transaction through an outbox. Consumers are idempotent.
Preserve action keys, retries, scheduled time and executed time. A
failed external side effect does not roll back a valid approval into an
unknown state.

**API04 \| R1 \| Integration access.** Provide documented versioned APIs
and scoped service accounts only for approved capabilities. Paginate
queries, limit export size, rate limit and audit sensitive access.
Webhook secrets rotate; signatures, timestamps and replay checks are
mandatory.

**Acceptance evidence:** Two reviewers approve different versions
simultaneously: only the current version can be approved. Two invoice
issue clicks create one invoice. A delayed queue message after role
revocation cannot export previously accessible files.

Suggested implementation stack is an engineer decision: a maintained web
framework, PostgreSQL or equivalent relational engine, versioned object
storage and a durable job queue. Record alternatives and dependency
support policies before choosing libraries.

PRODUCT REQUIREMENTS / 35

# Security, audit events and operations

Security is a release condition for the core, not an optional enterprise
feature.

**SEC01 \| R0 \| Verification baseline.** Map the application to OWASP
ASVS 5.0 Level 2 as a proposed target, with stronger controls for
secrets, signing and privileged operations. Record applicable controls
and evidence; do not claim certification from adopting the checklist.
\[S21\]

**SEC02 \| R0 \| Encryption and keys.** Use TLS for network paths and
approved encryption for databases, objects and backups. Keep keys in a
managed secret / key service separate from data, with rotation, backup
and access records. Encryption does not replace access controls or
protect data from every authorised administrator.

**SEC03 \| R0 \| Application hardening.** Prevent injection, XSS, CSRF,
SSRF, path traversal, insecure file access and unsafe deserialisation.
Validate uploads and rendered HTML. Use security headers, dependency /
secret scanning, scoped service identities and no public production
debug endpoints.

**SEC04 \| R0 \| Audit trail.** Capture actor, practice, action, record
ID, exact version, time, result and reason for sensitive changes,
grants, exports, approvals and secret reveals. Keep audit events append
only for the application identity, with independently protected copies /
integrity checks. Do not place passwords or full document bodies in
logs.

**SEC05 \| R0 \| Monitoring and incidents.** Monitor failed logins,
abnormal exports, privilege changes, queue failure, storage capacity,
backup failure and repeated cross scope access attempts. Assign an
incident owner and alert destination. Detection should preserve evidence
without sending confidential files to an unrestricted alert channel.

**SEC06 \| R0 \| Developer and vendor access.** Production access is
time limited, ticketed and least privilege. Use synthetic data in
development and QA. A developer cannot copy the client database to a
personal device for debugging. Support access and subprocessors are
recorded and reviewed.

**Acceptance evidence:** Perform independent authorisation and
penetration testing before production. No unresolved critical or high
severity finding without a documented, time limited risk decision
approved by the owner and security reviewer; fundamental isolation
failures block release outright.

Maintain an asset inventory, patch owner, incident runbook,
vulnerability response procedure and key recovery exercise. A lock icon
or "AES" label in the interface is not acceptance evidence.

PRODUCT REQUIREMENTS / 36

# Privacy, retention and regulatory clocks

Privacy requirements must reflect actual commencement, purpose and
record obligations.

**PRV01 \| R0 \| Processing register.** Identify the responsible
practice, processing purpose, data categories, source, access roles,
recipients, vendor, hosting location, retention class and applicable
legal basis / authority. Record notices and consent where required; do
not treat consent as the only possible basis for every professional
record.

**PRV02 \| R0 \| Regulatory state.** Track Enacted, Notified,
Operational, Prospective and Superseded requirements with sources and
effective rules. DPDP commencement is phased; core duties must not all
be described as operational on this research date. Build readiness
without mislabelling legal status. \[S15\]\[S16\]

**PRV03 \| R1 \| Rights and requests.** Provide verified requests for
access, correction, withdrawal and erasure, with authorised review and
response evidence. A portal closure or withdrawal does not automatically
delete audit evidence or records subject to law / hold. Record the
reason and scope of any retained data.

**PRV04 \| R0 \| Incident clocks.** For applicable CERT In directions,
assess specified cyber incidents against the six hour awareness based
reporting requirement and maintain applicable ICT logs for rolling 180
days in Indian jurisdiction. Keep this assessment distinct from routine
support incidents and future DPDP clocks. \[S17\]

**PRV05 \| R1 \| DPDP breach workflow.** When operative and applicable,
support affected person notice without delay, initial Board information
without delay and detailed Board information within 72 hours or
permitted extension. Maintain separate drafts, approvals and evidence;
do not replace these with a single 72 hour timer. \[S16\]

**PRV06 \| R0 \| Retention decisions.** Configure schedules by record
class, governing rule, trigger and hold, covering originals,
derivatives, email, AI and backups. Support applicable one year data /
log retention under DPDP Rules 6 and 8 when operative, reconciled with
longer duties. Neither CERT-In's 180 days nor inactivity / audit norms
are universal purge timers. \[S11\]\[S16\]\[S17\]

**Acceptance evidence:** An erasure request for an engagement under
legal hold is reviewed and partially actioned where appropriate, with
reasons. The incident screen shows awareness time and the correct
independent reporting clocks, even if root cause investigation is
incomplete.

This design supports confidentiality, professional obligations and
privacy readiness; it is not an automatic DPDP or ICAI compliance
certificate. Confirm current obligations, role allocation between
practices and vendor contracts before live processing.

PRODUCT REQUIREMENTS / 37

# Backup, disaster recovery and exit

Recovery must restore useful, correctly scoped records, not merely a
database file.

**BCP01 \| R0 \| Backup scope.** Back up the database, object versions,
configuration, templates, necessary keys / recovery material and audit
events under separate access controls. Keep an encrypted copy in a
separate failure domain and an immutable / offline copy where feasible.
Document approved locations and administrators.

**BCP02 \| R0 \| Recovery targets.** Proposed production targets: RPO no
greater than one hour and RTO no greater than eight hours for the core.
Measure the full restore, including identity, object links and critical
queues. If budget or infrastructure cannot meet the target, obtain an
explicit revised service level before go live.

**BCP03 \| R0 \| Restore controls.** Reconcile object manifests, hashes
and database references after restore. Reapply revoked access, legal
holds and approved erasures. Pause outbound messages and filings until
queued actions are reconciled so restoration cannot resend historical
communications or duplicate financial actions.

**BCP04 \| R0 \| Operational continuity.** Show degraded status for
internet, email, AI or connector outages. Keep work queues and local
functions available where infrastructure permits. Provide a controlled
emergency obligation export and a procedure for recording work performed
during downtime when the core returns.

**BCP05 \| R1 \| Export and vendor exit.** Authorised owners can export
structured data, original files, version manifests, approvals and audit
events in documented formats. Preserve IDs and relationships. Do not
require a proprietary viewer to read basic records. Export is scoped,
logged, encrypted and checked for secrets.

**BCP06 \| R0 \| Exercises and ownership.** Run a restore drill before
production and periodically thereafter, proposed quarterly. Record
achieved times, missing items, exceptions and remediation owner. Test
loss of the primary server, unavailable key service and departure of the
only administrator.

**Acceptance evidence:** Restore a synthetic production copy into an
isolated environment with external sending disabled. Verify a random
sample of original and signed file hashes, permissions, active
obligations and receipt balances. Report measured RPO / RTO rather than
a successful backup job alone.

The existing office server and AI workstation require capacity, UPS,
storage, maintenance and recovery assessment. Ownership of capable
hardware does not establish reliable hosting or disaster recovery by
itself.

PRODUCT REQUIREMENTS / 38

# Visual design, themes and accessibility

Minimalistic but vibrant: readable surfaces, restrained accents and
consistent interaction.

  -----------------------------------------------------------------------
  **Token / element**     **Light theme**         **Dark theme**
  ----------------------- ----------------------- -----------------------
  Canvas / surface        F6F7FB / FFFFFF         151A23 / 1F2733

  Primary text /          1F2937 / 526174         F1F5F9 / B8C3D6
  secondary text                                  

  Primary action / accent 5B4B8A                  C4B5FD
  text                                            

  Border / quiet divider  CBD5E1                  465366

  Gold accent             B08D44; decorative use  E5C67A; restrained
                                                  highlight

  Status                  Text label plus icon    Same meaning with
                          and tested colour       independently tested
                                                  contrast
  -----------------------------------------------------------------------

**UX01 \| R0 \| Theme behaviour.** Provide Light, Dark and System
settings saved per user. Apply theme to tables, charts, dialogs, empty
states and help. Switching theme preserves scroll, draft and selected
record. Printable outputs use an approved light document style unless
explicitly requested otherwise.

**UX02 \| R0 \| Type and spacing.** Use a readable sans serif with 16 px
default body text and optional comfortable density. Tables may use 14 px
with zoom support; avoid smaller essential text. Use consistent spacing,
clear labels and restrained elevation. No neon borders, constant
animation, glossy cards or decorative 3D charts.

**UX03 \| R0 \| Accessibility.** Target WCAG 2.2 AA. Test keyboard
navigation, focus, screen reader names, error association, zoom and
reflow. Normal text targets at least 4.5:1 contrast; meaningful
interface boundaries and large text use applicable thresholds. Aim for
44 px touch targets, exceeding the minimum where feasible. \[S22\]

**UX04 \| R0 \| Charts and tables.** Use accessible legends, exact
units, date range and table alternatives. Never use colour alone for
overdue / complete. Align amounts, freeze identifiers, wrap long labels
and offer saved columns. Exports preserve selected practice and filters.

**UX05 \| R0 \| Identity cues.** Show the full active practice name or
an unambiguous accessible label. Optional purple / teal practice markers
supplement text. A warning before cross practice changes must name both
source and destination; colour is not sufficient.

**Acceptance evidence:** Complete client onboarding, document review and
invoice issue using only the keyboard in both themes. At 200% zoom,
essential controls and text remain usable. Validate each final token
pairing, including errors and disabled states, rather than assuming dark
mode is a colour inversion.

PRODUCT REQUIREMENTS / 39

# Navigation, screen layouts and interaction states

Each screen should answer: where am I, what needs attention and what can
I do next?

  -----------------------------------------------------------------------
  **Screen**      **Visible hierarchy**              **Primary action**
  --------------- ---------------------------------- --------------------
  Home            Practice context → personal        Open next work item
                  priorities → exceptions → small    
                  set of relevant metrics.           

  My work         Saved views → filters → readable   Update or submit for
                  list / optional board → detail     review
                  drawer.                            

  Client          Identity and authority →           Create scoped
  workspace       engagements → requests / files /   engagement or
                  timeline → finance if permitted.   request

  Job detail      Service / period / deadline →      Complete current
                  owner and blocker → checklist →    permitted step
                  evidence → review history.         

  Review queue    Risk / due date order → exact      Approve or request
                  version → exceptions → decision    changes
                  with reason.                       

  Practice        Role learning → service playbooks  Open relevant guide
                  → templates → sample practice →    or exercise
                  manual.                            
  -----------------------------------------------------------------------

**NAV01 \| R0 \| Menu.** Default staff navigation: Home, My work,
Clients, Calendar, Documents, Practice and More. Finance can pin
Billing; managers can pin Team / Reports. Communications and specialist
packs remain discoverable through contextual tabs and authorised
shortcuts. Never show a large grid of every module at login.

**NAV02 \| R0 \| Search and context.** Provide permission aware global
search by client, job, document and reference, with type filters and
safe snippets. Preserve breadcrumbs and a Back destination. Recent items
clear on logout and are scoped when practice changes.

**NAV03 \| R0 \| Five states.** For each screen specify normal, empty,
loading, error and permission / conflict states. Empty work says "No
work assigned"; failed save preserves the draft; stale record says "This
record changed. Review the latest version"; denied access offers a
request route without revealing protected facts.

**NAV04 \| R0 \| Safe actions.** Show progress and disable duplicate
submission while an action is pending. Provide undo for low impact
reversible edits; use explicit confirmation for issue, release, bulk
share and purge. Never use a success toast before the authoritative
transaction commits.

**Acceptance evidence:** A new article reaches assigned work from login
without a tutorial. A failed upload retains its context and a retry
option. A deep link to the wrong practice is rejected safely and does
not silently switch authority.

PRODUCT REQUIREMENTS / 40

# Reports, definitions and management decisions

Every metric must identify scope, period, status basis and drill through
records.

  -----------------------------------------------------------------------
  **Metric /       **Definition**                    **Decision
  report**                                           supported**
  ---------------- --------------------------------- --------------------
  On time filing   Applicable obligations due in     Identify delivery
  rate             selected period that were filed   risk; inspect
                   by the approved effective due     acknowledgement
                   date ÷ applicable obligations     evidence.
                   due. Show unknown / disputed      
                   cases separately.                 

  Work and review  Elapsed time in current state,    Resolve bottlenecks
  ageing           with separate client waiting and  and review capacity.
                   internal waiting durations.       

  Document         Required checklist items accepted Determine whether
  completeness     ÷ required applicable items;      preparation can
                   received alone is a separate      proceed.
                   measure.                          

  Receivables      Issued amount less approved       Prioritise
  ageing           receipts, tax deductions /        collection and
                   credits and credit notes, aged    disputes.
                   from invoice due date.            

  Time utilisation Approved client work time ÷       Plan staffing; avoid
                   defined available capacity; show  misleading
                   billable, nonbillable and leave   surveillance scores.
                   separately.                       

  Engagement       Agreed fees, recognised           Review scope and
  economics        management revenue basis, billed  resourcing without
                   amount, collections, approved     mixing cash and
                   time cost and WIP shown           revenue.
                   separately.                       

  Practice quality Open exceptions, overdue          Direct partner
                   assembly, independence reviews,   attention to
                   unresolved monitoring findings    professional risk.
                   and UDIN actions.                 
  -----------------------------------------------------------------------

**REP01 \| R0 \| Report controls.** Provide filters by permitted
practice, branch, team, service, owner, client and period. Each report
shows refresh time, formula definition and record count. An empty
denominator displays Not available; missing information must not
silently become zero.

**REP02 \| R1 \| Combined reports.** Combined views state which
practices are included and show a breakdown. Shared staff and allocated
costs have a documented elimination rule. Do not label internal combined
management views as statutory accounts or consolidated financial
statements.

**REP03 \| R1 \| Targets and baseline.** Measure current BHV performance
before setting improvement targets. Track adoption, document retrieval
time, unassigned due work, review delay and reconciliation exceptions.
Do not promise arbitrary savings from vendor marketing or invent
baseline data.

**Acceptance evidence:** Drill from a chart to its underlying authorised
records and reconcile totals to an exported report. A deadline extension
applies the documented current date policy while retaining a historical
snapshot for prior reports.

PRODUCT REQUIREMENTS / 41

# Performance, availability and measurable quality

These are proposed engineering acceptance targets, to be confirmed
against the selected deployment.

  -----------------------------------------------------------------------
  **Area**           **Initial target / test condition**
  ------------------ ----------------------------------------------------
  Interactive use    95th percentile common list / detail response within
                     2 seconds; permission aware search within 3 seconds
                     under the agreed profile.

  Large profile load Test 75 concurrent active staff sessions against the
                     section 6 large data envelope, with realistic
                     permission filters and representative attachments.

  Background work    Imports, bulk exports, OCR and AI run asynchronously
                     with progress and cancellation. No synchronous
                     request waits for a full bulk job.

  Availability       Proposed 99.5% monthly core service availability,
                     with a written measurement rule and maintenance
                     disclosure. Infrastructure and support scope must
                     sustain it.

  Recovery           RPO ≤ 1 hour; RTO ≤ 8 hours for the core,
                     demonstrated by restore. Actual measured results are
                     recorded.

  Data integrity     Zero duplicate issued invoices or duplicate logical
                     filing records in retry / concurrency tests;
                     transactional constraints prevent cross scoped
                     references.

  Access and         No unresolved cross practice disclosure path; WCAG
  accessibility      2.2 AA review of critical journeys in both themes.

  Operations         Health checks, queue age, backup status, storage /
                     key expiry and error correlation visible to
                     authorised operations staff.
  -----------------------------------------------------------------------

**NFR01 \| R0 \| Test realism.** Measure network latency, database size,
concurrent workload and cache state. Report p50 / p95 / p99, error rate
and test duration, not just a single page load. Large exports must not
starve ordinary work or statutory reminder processing.

**NFR02 \| R0 \| Financial precision.** Use decimal arithmetic, named
rounding rules and currency precision. Test split allocations,
reversals, negative credit notes, rate changes and financial year
boundaries. Store original and converted amounts with the applied rate
and date.

**NFR03 \| R0 \| Maintainability.** Require automated migrations,
documented module boundaries, reproducible builds, versioned
configuration and dependency inventory. Avoid one enormous script,
embedded passwords or business rules duplicated across UI and backend.

**Acceptance evidence:** Load test with AI and export workers active;
show that user requests and reminders still meet the agreed service
class. If a target fails, document the bottleneck, remediation and
revised acceptance plan before scaling.

No hardware bill of materials or fixed engineering quotation is assumed.
Capacity, document volume, uptime expectations and operating budget
require discovery and measured sizing.

PRODUCT REQUIREMENTS / 42

# Acceptance scenarios and test evidence

Every release must prove happy paths and consequential failure paths
using synthetic clients.

  -----------------------------------------------------------------------
  **Scenario**        **Required proof**
  ------------------- ---------------------------------------------------
  Two practices, one  Separate engagement, invoice, bank and report
  client              identity; combined view only for an explicitly
                      authorised user.

  Authorisation       Wrong practice IDs, guessed URLs, search snippets,
  attack              object links, exports, queue jobs and AI queries
                      disclose no protected data.

  Monthly recurrence  Two scheduler runs and a retry create one period
                      job. Template changes preserve existing jobs unless
                      approved migration occurs.

  Deadline revision   A category limited extension changes only matching
                      open obligations and preserves its source, old date
                      and approval.

  Review and issue    Material edit invalidates approval; required
                      independent review remains enforced; only
                      authorised signatory can issue.

  Document release    Originals and versions remain intact; client sees
                      only explicitly released versions; malware / unsafe
                      archives are quarantined.

  Payment allocation  Part receipt, TDS deduction and credit note
                      reconcile; repeated connector callback does not
                      duplicate a receipt.

  Client upload       Mobile upload interruption recovers; wrong period
                      is flagged; receipt confirmation does not imply
                      professional acceptance.

  Leaver / delegation Sessions and exports revoke; work transfers;
                      authorship remains; temporary grant expires across
                      all services.

  Restore / outage    Restore resolves files and keys, honours holds /
                      erasures, and does not replay outbound actions.
                      Offline / degraded status is truthful.

  AI misuse           Injected instructions cannot exfiltrate data or
                      trigger actions; output cites permitted versions;
                      unverified fields stay draft.

  Theme and help      Keyboard and phone journeys work in both themes;
                      contextual manual matches actual fields and error
                      messages.
  -----------------------------------------------------------------------

## Evidence pack

For each scenario retain test ID, linked requirement IDs, build /
configuration, synthetic dataset version, steps, expected result, actual
result, screenshots or logs, tester, date, defects and retest status.
Mark an unexecuted test Unverified. A recorded demo alone does not
replace negative permission, recovery or financial integrity testing.

UAT participants: at least a practice authority for each concern, a
manager / reviewer, an article or staff user, finance / admin, and a
client representative using synthetic data. Use independent security
review for the release boundary.

PRODUCT REQUIREMENTS / 43

# Migration and implementation onboarding

A clean migration is part of the product, not an informal spreadsheet
upload.

**MIG01 \| R0 \| Inventory and mapping.** Inventory existing
spreadsheets, client folders, registers, task tools and accounting
references. Identify owner, practice, source date, identifiers, missing
fields and retention status. Classify confidential data before any
engineer receives it.

**MIG02 \| R0 \| Import pipeline.** Upload to a staging area; map
columns; validate types and identifiers; preview duplicates and practice
assignments; produce rejects with row references. Do not activate
imported records automatically. Use a unique batch and source hash for
repeat protection.

**MIG03 \| R0 \| Reconciliation.** Compare source and destination
counts, open obligations, invoice balances, file counts and selected
hashes. Record accepted exclusions, duplicates resolved and unresolved
items. Do not claim exact completeness from matching row counts alone.

**MIG04 \| R0 \| Cutover.** Choose a pilot service and representative
clients from each practice. Agree a cutover date, source freeze, data
owner and rollback trigger. If parallel operation is used, designate one
source of truth per field and a reconciliation owner to avoid divergent
deadlines.

**MIG05 \| R0 \| Training and adoption.** Run role based sessions in
Sample practice, followed by supervised real workflows. Provide quick
guides for client intake, work review, document requests, invoices,
access changes and incident reporting. Collect usability findings and
resolve material blockers before expansion.

**MIG06 \| R1 \| Ongoing quality.** Schedule duplicate, orphaned record,
missing owner, stale contact, missing source and unverified deadline
reports. Assign correction owners. Keep migration audit records even
when source systems are retired under the approved retention plan.

**Acceptance evidence:** Import the same client file twice; second
import is identified and cannot duplicate records. The owner signs off
practice assignments and opening balances. Restore the pre import
snapshot in an isolated test and verify rollback readiness.

Migration access is temporary. Production identifiers and files should
not be copied into an engineer's personal cloud account, a public coding
assistant or an unapproved test environment.

PRODUCT REQUIREMENTS / 44

# Delivery milestones and engineering gates

Commission a sequence of working, reviewable releases with clear
ownership.

  ------------------------------------------------------------------------
  **Milestone**   **Engineer deliverable**            **Acceptance owner**
  --------------- ----------------------------------- --------------------
  Discovery       Confirmed data inventory, entity /  Practice owner and
  baseline        role map, priority workflows,       representatives of
                  hosting options and risk register.  both concerns.

  UX prototype    Clickable core journeys in light    Staff, manager,
                  and dark; small practice            finance and owner.
                  navigation; manual outline;         
                  synthetic data.                     

  Secure          Identity, two practice isolation,   Technical reviewer
  foundation      audit events, storage, backups, CI  and independent
                  and deployment automation.          security reviewer.

  Operational     Clients, engagements, recurring     CA process owner
  pilot           jobs, deadline register, requests,  plus pilot users.
                  documents, basic billing and help.  

  Professional    Reviewed audit, tax, GST,           Eligible domain
  packs           corporate, notice and certificate   reviewers and
                  workflows; finance / resource       signing authorities.
                  depth.                              

  AI / connectors Documented scopes, evaluation       Security, domain and
                  reports, approved data routing,     operations owners.
                  integration recovery and measured   
                  costs.                              

  Production      Migration reconciliation, UAT,      Named go live
  release         restore drill, incident exercise,   authority for each
                  training and ownership handover.    practice.
  ------------------------------------------------------------------------

## Definition of done for a feature

Requirements and permission model approved; all five UI states
implemented; automated meaningful tests pass; audit events and failure
recovery work; documentation and training updated; accessibility
checked; migration / rollback considered; no production secrets in
source; evidence attached to the ticket. Security and professional
blocks are resolved before release.

## Change control

Keep an engineering backlog linked to this PRD's IDs. A proposed new
feature states the user problem, priority, affected data / permissions,
effort, dependencies and acceptance test. Changes to legal rules, data
export, AI destinations or signing workflows require the respective
domain owner, not developer approval alone.

Request estimates by milestone and acceptance deliverable, with
assumptions, staffing, dependencies and recurring operating costs
separated. This document does not invent a completion date, fixed price
or guarantee that one employee can safely deliver the full scope alone.

PRODUCT REQUIREMENTS / 45

# Engineer handover and release ownership

The firm must be able to understand, operate, secure and transfer the
software after delivery.

**DEL01 \| R0 \| Source and accounts.** Keep source code, issue tracker,
domain, hosting, identity, storage and deployment accounts under firm
controlled ownership. Record licences and third party dependencies. No
critical service may depend solely on the employee's personal account.

**DEL02 \| R0 \| Technical pack.** Deliver architecture diagrams, data
dictionary, migrations, API documentation, environment configuration
guide, automated build / deployment, test suite, dependency inventory,
backup / restore instructions and incident runbooks. Include a safe
sample configuration with no working secrets.

**DEL03 \| R0 \| User pack.** Deliver inbuilt and downloadable manuals,
role quick guides, template administration instructions and short screen
recordings using synthetic records. Include permission administration,
new practice onboarding, leaver handling and how to pause all external
automations.

**DEL04 \| R0 \| Operational handover.** Document monitoring, support
contacts, patching, key rotation, licence renewal, escalation and
recovery ownership. Demonstrate that a second authorised person can
deploy a release and restore the system without the original engineer.

**DEL05 \| R1 \| Acceptance and warranty.** Record acceptance scope,
known limitations, open issues, support response expectations and a
defect correction process in the engagement with the engineer.
Distinguish a bug in an agreed feature from a new feature request. Legal
/ commercial terms require their own reviewed agreement.

## Instruction to give the engineer

Use this PRD as the proposed baseline for BHV Practice Management. First
produce a requirement traceability backlog, a core journey prototype and
an architecture / threat review. Implement R0 in demonstrable slices.
Preserve the two practices' boundaries and human approvals in every
route. Do not deploy real client data, activate external AI, send
messages or enable filing / signing integrations until the authorised
owners approve the relevant tested configuration. Mark assumptions and
unsupported integrations explicitly. Deliver source, tests,
documentation and operating control to the firm.

**Acceptance evidence:** A substitute administrator follows the handover
guide to restore a test instance, create a restricted staff user,
inspect a failed reminder and export one permitted client engagement
without developer assistance.

PRODUCT REQUIREMENTS / 46

# Open decisions, risks and final review

These items need owner input before implementation commitments; they do
not prevent using this PRD for engineer selection.

  -----------------------------------------------------------------------
  **Decision /      **Proposed baseline**            **Who confirms**
  risk**                                             
  ----------------- -------------------------------- --------------------
  Registered        Use supplied trade names only    Partner / proprietor
  identities        until identifiers and proprietor and finance.
                    / signatories are verified.      

  Ethical           Assess ownership, shared         Responsible CA /
  relationship      branding, resources and          ethics adviser.
                    independence implications; do    
                    not infer network status from    
                    domain alone.                    

  Hosting and       Firm controlled core; compare    Owner, technical
  recovery          approved India cloud option;     lead and security
                    separate AI service.             reviewer.

  Scale and cost    Validate section 6 load profile, Owner and engineer.
                    document volume, uptime,         
                    staffing and recurring provider  
                    costs.                           

  Scope order       R0 first; prioritise R1 packs by Practice process
                    actual services and statutory    owners.
                    risk.                            

  Existing systems  Identify authoritative books,    Finance / admin and
                    email, documents and calendars;  engineer.
                    verify export / API rights.      

  Data and AI       No client training by default;   Owner and privacy /
  policy            local confidential inference;    security lead.
                    cloud only through approved      
                    policy.                          

  Client access     Mandated contacts only; released Engagement owner and
                    documents; no automatic group    client authority.
                    access.                          

  Professional      Approve templates, current legal Eligible domain
  methodology       rules, review gates and          reviewers.
                    retention before activation.     

  Commercial        Separate customer tenants and a  Owner and legal /
  expansion         separate privacy / support /     technical advisers.
                    licensing assessment before sale 
                    to other firms.                  
  -----------------------------------------------------------------------

## Major delivery risks

Scope overload can delay a reliable core; phase specialist engines. Poor
migration can corrupt firm ownership; reconcile before cutover.
Unverified integrations can block filing promises; retain manual
evidence workflows. A single administrator or engineer creates
continuity risk; require shared firm ownership and a tested handover.
Visual polish cannot compensate for missing authorisation, recovery or
professional review.

Recommended next step: engineer discovery and delivery task breakdown
against these requirements, followed by review of the core prototype and
threat model. This PRD intentionally stops at the specification
boundary; it does not authorise production deployment or create user
accounts.

PRODUCT REQUIREMENTS / 47

# Requirement traceability index

Map each requirement ID to an engineering ticket, test and release
evidence. Preserve IDs when wording changes.

  -----------------------------------------------------------------------------------
  **Sec.**   **Module**            **Requirement IDs**                  **Release**
  ---------- --------------------- ------------------------------------ -------------
  7          Practice boundaries   ORG01, ORG02, ORG03, ORG04, ORG05,   R0/R1
             and shared            ORG06                                
             administration                                             

  8          Roles and permission  IAM01, IAM02, IAM03, IAM04, IAM05,   R0/R1
             rules                 IAM06                                

  10         Login, credentials    AUTH01, AUTH02, AUTH03, AUTH04,      R0/R1/R2
             and signing devices   AUTH05, AUTH06                       

  11         Client registry,      CLI01, CLI02, CLI03, CLI04, CLI05,   R0/R1
             intake and acceptance CLI06                                

  12         Service catalogue and ENG01, ENG02, ENG03, ENG04, ENG05,   R0/R1
             engagements           ENG06                                

  13         Workflows, recurring  WRK01, WRK02, WRK03, WRK04, WRK05,   R0/R1
             jobs and staff queues WRK06                                

  14         Statutory calendar    DUE01, DUE02, DUE03, DUE04, DUE05,   R0/R1
             and deadline          DUE06                                
             intelligence                                               

  15         Document management   DOC01, DOC02, DOC03, DOC04, DOC05,   R0/R1
             and evidence custody  DOC06                                

  16         Communication and     COM01, COM02, COM03, COM04, COM05,   R0/R1/R2
             client requests       COM06                                

  17         Client portal and     POR01, POR02, POR03, POR04, POR05,   R0/R1
             external              POR06                                
             collaboration                                              

  18         Income tax and tax    TAX01, TAX02, TAX03, TAX04, TAX05,   R1
             audit practice pack   TAX06                                

  19         GST, TDS and          GST01, GST02, GST03, GST04, GST05,   R1/R2
             recurring compliance  GST06                                

  20         Corporate law and     COR01, COR02, COR03, COR04, COR05,   R1
             entity secretarial    COR06                                
             work                                                       
  -----------------------------------------------------------------------------------

Authored requirements: 189. Release allocation: R0: 97, R1: 77, R2: 15.
These are requirement counts, not effort estimates.

The engineer's traceability register must add ticket URL, implementation
owner, current status, test IDs, defect references and acceptance
evidence for every ID. A requirement marked deferred must state the
approved release and operational workaround. Professional and security
controls cannot be deferred merely because a screen is incomplete.

PRODUCT REQUIREMENTS / 48

# Requirement traceability index

Map each requirement ID to an engineering ticket, test and release
evidence. Preserve IDs when wording changes.

  -----------------------------------------------------------------------------------
  **Sec.**   **Module**            **Requirement IDs**                  **Release**
  ---------- --------------------- ------------------------------------ -------------
  21         Audit planning, risk  AUD01, AUD02, AUD03, AUD04, AUD05,   R1
             and engagement        AUD06                                
             quality                                                    

  22         Audit completion,     AUD07, AUD08, AUD09, AUD10, AUD11,   R1
             reporting and file    AUD12                                
             assembly                                                   

  23         Notices, litigation   LIT01, LIT02, LIT03, CERT01, CERT02, R1
             and certificates      CERT03                               

  24         Accounting, advisory  ACC01, ACC02, ADV01, ADV02, ADV03,   R1/R2
             and specialist        ADV04                                
             practices                                                  

  25         Fees, invoicing and   FIN01, FIN02, FIN03, FIN04, FIN05,   R0/R1
             collections           FIN06                                

  26         People, time and      HR01, HR02, TIM01, TIM02, RES01,     R1
             capacity              RES02                                

  27         Internal              OPS01, OPS02, OPS03, OPS04, OPS05,   R1
             administration,       OPS06                                
             assets and AI                                              
             spending                                                   

  28         Knowledge, templates  KNW01, KNW02, KNW03, KNW04, KNW05,   R0/R1
             and the Practice menu KNW06                                

  29         AI assistance and     AI01, AI02, AI03, AI04, AI05, AI06   R2
             human decision                                             
             boundaries                                                 

  30         AI evaluation and     AIE01, AIE02, AIE03, AIE04           R2
             source processing                                          

  31         Integration catalogue INT01, INT02                         R0/R1
             and boundaries                                             

  33         Core data model and   DAT01, DAT02, DAT03                  R0
             record dictionary                                          

  34         API contracts, events API01, API02, API03, API04           R0/R1
             and concurrent work                                        
  -----------------------------------------------------------------------------------

Authored requirements: 189. Release allocation: R0: 97, R1: 77, R2: 15.
These are requirement counts, not effort estimates.

The engineer's traceability register must add ticket URL, implementation
owner, current status, test IDs, defect references and acceptance
evidence for every ID. A requirement marked deferred must state the
approved release and operational workaround. Professional and security
controls cannot be deferred merely because a screen is incomplete.

PRODUCT REQUIREMENTS / 49

# Requirement traceability index

Map each requirement ID to an engineering ticket, test and release
evidence. Preserve IDs when wording changes.

  -----------------------------------------------------------------------------------
  **Sec.**   **Module**            **Requirement IDs**                  **Release**
  ---------- --------------------- ------------------------------------ -------------
  35         Security, audit       SEC01, SEC02, SEC03, SEC04, SEC05,   R0
             events and operations SEC06                                

  36         Privacy, retention    PRV01, PRV02, PRV03, PRV04, PRV05,   R0/R1
             and regulatory clocks PRV06                                

  37         Backup, disaster      BCP01, BCP02, BCP03, BCP04, BCP05,   R0/R1
             recovery and exit     BCP06                                

  38         Visual design, themes UX01, UX02, UX03, UX04, UX05         R0
             and accessibility                                          

  39         Navigation, screen    NAV01, NAV02, NAV03, NAV04           R0
             layouts and                                                
             interaction states                                         

  40         Reports, definitions  REP01, REP02, REP03                  R0/R1
             and management                                             
             decisions                                                  

  41         Performance,          NFR01, NFR02, NFR03                  R0
             availability and                                           
             measurable quality                                         

  43         Migration and         MIG01, MIG02, MIG03, MIG04, MIG05,   R0/R1
             implementation        MIG06                                
             onboarding                                                 

  45         Engineer handover and DEL01, DEL02, DEL03, DEL04, DEL05    R0/R1
             release ownership                                          
  -----------------------------------------------------------------------------------

Authored requirements: 189. Release allocation: R0: 97, R1: 77, R2: 15.
These are requirement counts, not effort estimates.

The engineer's traceability register must add ticket URL, implementation
owner, current status, test IDs, defect references and acceptance
evidence for every ID. A requirement marked deferred must state the
approved release and operational workaround. Professional and security
controls cannot be deferred merely because a screen is incomplete.

PRODUCT REQUIREMENTS / 50

# Research sources and evidence notes

Official and public material checked on 7 September 2026. Click a source
title to open the original.

[\[S01\] Jamku product page](https://madrecha.com/jamku/)

Official product description. Indian practice registers, work, time and
administration patterns; no live product test.

[\[S02\] Zoho Practice
features](https://www.zoho.com/practice/features/)

Official feature descriptions for requests, workpapers, recurring work,
portal and workflow history.

[\[S03\] Karbon product overview](https://karbonhq.com/)

Official product positioning and feature families. Roadmap statements
were not treated as released features.

[\[S04\] TaxDome overview](https://taxdome.com/overview)

Official pipelines, client intake, documents and billing descriptions;
foreign signing and tax support do not establish Indian validity.

[\[S05\] FYI product overview](https://fyi.app/)

Official document, email, job and approval patterns. Public descriptions
only.

[\[S06\] CCH iFirm global
overview](https://www.wolterskluwer.com/en/solutions/cch-ifirm)

Official central client / practice ecosystem overview. Regional editions
and tax capabilities differ.

[\[S07\] Jamku LinkedIn product
profile](https://www.linkedin.com/products/madrecha-and-company-jamku-practice-management-software/)

Public company description; adoption figures dated June 2022 were not
used as current evidence.

[\[S08\] Karbon LinkedIn company
profile](https://www.linkedin.com/company/karbonhq)

Public company positioning on connected distributed teams; not an
independent performance review.

[\[S09\] Jason Staats: sponsored Karbon
demonstration](https://www.linkedin.com/posts/jstaats_run-an-accounting-firm-of-20-people-here-activity-7295506592278425603-OxG1)

Public post / transcript about saved views, capacity, communication and
recurring work. Sponsorship disclosed; anecdotal comments not
generalised.

Research supports the requirements stated here; it does not prove that a
vendor or future BHV implementation passes them. Statutory
interpretation and product entitlements must be rechecked before
production acceptance.

PRODUCT REQUIREMENTS / 51

# Research sources and evidence notes

Official and public material checked on 7 September 2026. Click a source
title to open the original.

[\[S10\] Adarsh Madrecha LinkedIn
profile](https://in.linkedin.com/in/adarshmadrecha)

Search snippet available; full profile retrieval failed. No detailed
profile assessment relied on.

[\[S11\] ICAI SA 230: Audit
Documentation](https://resource.cdn.icai.org/15372Link7_SA230-standard.pdf)

Primary standard: procedures, evidence, preparer / reviewer, final
assembly, retention and documented amendments.

[\[S12\] ICAI: deferment of SQM 1 and SQM 2 effective
date](https://www.icai.org/post/announcement-on-deferment-of-effective-date-of-sqm-1-and-sqm-2)

Announcement dated 31 March 2026. Mandatory application deferred until
further announcement; extant SQC 1 continues.

[\[S13\] ICAI Code of Ethics 2026, Volume
II](https://resource.cdn.icai.org/92476coe2026v2.pdf)

Primary ethics source for confidentiality, firm relationships,
independence and nonassurance service considerations.

[\[S14\] ICAI SQC 1](https://resource.cdn.icai.org/15366Link1.pdf)

Primary quality control framework: ethics, acceptance, competence,
engagement performance and monitoring.

[\[S15\] MeitY: DPDP commencement
notification](https://www.meity.gov.in/static/uploads/2025/11/c56ceae6c383460ca69577428d36828b.pdf)

G.S.R. 843(E), November 2025: phased commencement. Confirm publication
linked operational dates and later amendments before activation.

[\[S16\] MeitY: Digital Personal Data Protection Rules
2025](https://www.meity.gov.in/static/uploads/2025/11/53450e6e5dc0bfa85ebd78686cadad39.pdf)

Primary rules, read with commencement provisions. Source for privacy
controls and distinct breach notification stages.

[\[S17\] CERT In Directions dated 28 April
2022](https://www.cert-in.org.in/PDF/CERT-In_Directions_70B_28.04.2022.pdf)

Specified incident reporting, applicable ICT log retention and time
synchronisation. Entity and incident applicability need assessment.

[\[S18\] ICAI UDIN announcement dated 1 April
2026](https://www.icai.org/post/udin-announcement-one-time-relaxation)

Historical relaxation notice also confirms general generation timing; do
not treat the relaxation as a permanent extension.

Research supports the requirements stated here; it does not prove that a
vendor or future BHV implementation passes them. Statutory
interpretation and product entitlements must be rechecked before
production acceptance.

PRODUCT REQUIREMENTS / 52

# Research sources and evidence notes

Official and public material checked on 7 September 2026. Click a source
title to open the original.

[\[S19\] Income Tax Department: returns transition
FAQs](https://www.incometax.gov.in/iec/foportal/help/all-topics/e-filing-services/%20income%20tax%20returns-faq)

Primary guidance distinguishing earlier FY / AY filings under the 1961
Act and newer tax years. Preserve governing regime and form history.

[\[S20\] ICAI SA 580: Written
Representations](https://resource.cdn.icai.org/15403Link38_sa580.pdf)

Primary standard for responsible management representations, timing,
evidential limits and reporting considerations.

[\[S21\] OWASP Application Security Verification
Standard](https://owasp.org/www-project-application-security-verification-standard/)

Official ASVS project and version 5.0.0 reference. Basis for a proposed
verification target, not product certification.

[\[S22\] W3C Web Content Accessibility Guidelines
2.2](https://www.w3.org/TR/WCAG22/)

Official accessibility standard. Source for AA design / test criteria;
44 px target is this PRD's enhanced design preference.

[\[S23\] GSTN GSP ecosystem](https://www.gstn.org.in/gsp-ecosystem)

Official search extract describes secure API based ecosystem. Full page
returned no readable text; validate the chosen provider interface
directly.

[\[S24\] TallyHelp: Integrate with
TallyPrime](https://help.tallysolutions.com/integrate-with-tallyprime/)

Official integration guidance. Specific supported read / write contracts
and deployment must be verified during implementation.

[\[I01\] ICAI AI use case directory](https://ai.icai.org/usecases.php)

User supplied discovery source. Author submissions are not independent
assurance, regulatory authority or product endorsement.

[\[I02\] CA office practice management application: CA Gagan
Shetty](https://ai.icai.org/usecases_details.php?id=276)

Readable submission: onboarding, service master, task review,
communication, alerts and exit reassignment.

[\[I03\] TimeTrack: CA Anumita
Mukherjee](https://ai.icai.org/usecases_details.php?id=273)

Readable submission: project timers, filters and histories. Demo
verification / storage shortcuts rejected for production.

Research supports the requirements stated here; it does not prove that a
vendor or future BHV implementation passes them. Statutory
interpretation and product entitlements must be rechecked before
production acceptance.

PRODUCT REQUIREMENTS / 53

# Research sources and evidence notes

Official and public material checked on 7 September 2026. Click a source
title to open the original.

[\[I04\] InvoicePro: CA Shikha
Sharma](https://ai.icai.org/usecases_details.php?id=306)

Readable submission: roles, invoice intake, change history and approval
invalidation. Simplistic tax logic not adopted.

[\[I05\] CERTIFY GENIE: CA Gopi
Manigandan](https://ai.icai.org/usecases_details.php?id=272)

Readable submission: guided evidence, extraction review, preview and
UDIN field. No automatic issuance or universal tolerance adopted.

[\[I06\] CA Digital Assistant: CA AVSR
Kushwanth](https://ai.icai.org/usecases_details.php?id=335)

Readable submission: client linked intake, classification, routing and
logs. No portal bypass or credential automation inferred.

[\[I07\] Statutory compliance tracking: CA Amit
Jain](https://ai.icai.org/usecases_details.php?id=141)

Readable submission: compliance master, allocation, reminders and
backups. Future enhancements not treated as implemented.

[\[I08\] Virasat AI: CA Panav
Vyas](https://ai.icai.org/usecases_details.php?id=334)

Readable submission: family / entity context, local knowledge, masking,
traceable outputs and synthetic practice. Security claims require
testing.

[\[I09\] DeltaBooks: CA Kamalapuram Nitheesh
Kumar](https://ai.icai.org/usecases_details.php?id=316)

Readable submission: confirmation lifecycle, reconciliation and
evidence. Suggested matches remain subject to auditor review.

Research supports the requirements stated here; it does not prove that a
vendor or future BHV implementation passes them. Statutory
interpretation and product entitlements must be rechecked before
production acceptance.

PRODUCT REQUIREMENTS / 54

# Additional research and access gaps

These limitations define the boundary of the evidence reviewed.

[Mayur Zanjrukiya: public Smart Audit Collaboration
post](https://www.linkedin.com/posts/mayur-zanjrukiya-b7678615b_icai-aiinaudit-hackathon-activity-7457102628720701440-DOqy)

Public authorship and hackathon focus were visible. The linked video was
not watched and detailed production capability is not inferred.

[PRIMAFELICITAS: integrated audit execution and monitoring
article](https://www.linkedin.com/pulse/integrated-ai-platform-audit-execution-monitoring-unqbc)

Public vendor article dated 11 June 2026 describes document requests,
review / reopen states and audit query ownership. It is not an
independent evaluation; its statistical claims were not adopted.

## ICAI detail pages with access restrictions

Directory metadata was visible, but the following detail pages returned
HTTP 403 or incomplete text. They were not used to substantiate detailed
feature claims:

[CA Practice Management
System](https://ai.icai.org/usecases_details.php?id=309)

[AI Built Practice Management Software for CA
Firms](https://ai.icai.org/usecases_details.php?id=220)

[Income Tax Notice Management
Automation](https://ai.icai.org/usecases_details.php?id=268)

[Smart Audit Collaboration
Tool](https://ai.icai.org/usecases_details.php?id=275)

[AI Assisted File Tracking
System](https://ai.icai.org/usecases_details.php?id=267)

[COMPLY Statutory Notices Management
System](https://ai.icai.org/usecases_details.php?id=266)

[DriveOrganizer Pro](https://ai.icai.org/usecases_details.php?id=212)

[CA Office Data Management
Hub](https://ai.icai.org/usecases_details.php?id=178)

## Scope of verification

The review covers readable public pages, selected use case text and
primary regulatory material. It does not include paid vendor accounts,
complete LinkedIn histories, private profiles, unseen videos, source
code audits or security tests of referenced products. No client
information was used in research. Requirements beyond observed features
are original BHV design proposals, with explicit release and acceptance
conditions.

BUILD BRIEF / 01

BHV AI Spend Tracker

Subscriptions • Payments • Hardware • Software • Budget

A simple spreadsheet with a clear dashboard and professional payment
reminders.

Prepared for B H Vyas & Associates and CA Panav Vyas. This document is a
generation brief: use it to obtain a working Google Sheets tool with
Apps Script, or an Excel workbook with VBA. It does not itself install
software or activate emails.

## Recommended approach

Use Google Sheets with a small attached Apps Script. Keep amounts,
budget comparisons and dashboard summaries in spreadsheet formulas. Use
the script only for setup, recording payments, advancing confirmed
renewals and sending reminders. Scheduled triggers can run without the
spreadsheet being open; their timing is approximate and they run under
the account that creates them. \[1\]

## What you should be able to do

-   See what each AI tool costs, when the next payment is due, how it
    will be paid and whether it renews automatically.

-   Record hardware and software purchases, then compare actual cash
    spending with a monthly budget.

-   Receive one readable email when a payment, overdue item or
    cancellation decision needs attention.

## Deliberately simple

Six visible sheets, three charts, normal filters and dropdowns. No
separate app, database, bank connection, AI API or accounting
integration. Amounts are entered from invoices and payment records. No
real subscription prices, email addresses or hardware costs are assumed.

## How to use this document

For Google Sheets, attach this Word file to a new chat and paste the
Google generation prompt on page 10. For Excel, use the prompt on page
11. Alternatively, paste the entire document and state which route to
build. The shared requirements on pages 2 to 9 apply to both routes.

Defaults: INR reporting • India date format • Asia/Kolkata timezone •
April to March financial year • owner recipient only until configured.

BUILD BRIEF / 02

# The workbook and visual experience

  -------------------------------------------------------------------------
  **Sheet**       **Purpose**                         **Routine use**
  --------------- ----------------------------------- ---------------------
  Dashboard       Spend, budget and payment           Read first
                  priorities                          

  Subscriptions   One row per recurring plan or trial Update when a plan
                                                      changes

  Investments     One row per hardware or software    Add purchases and
                  purchase                            commitments

  Payments        One row per completed cash          Record payments or
                  transaction                         refunds

  Budget          Monthly limits and actual           Set limits and review
                  comparisons                         monthly

  Settings        Owner, reminders, lists and quick   Initial setup;
                  instructions                        occasional changes
  -------------------------------------------------------------------------

Keep one additional Automation Log sheet hidden by default and available
through the menu. It records reminder runs and controlled actions; it is
not an extra sheet that the user must maintain.

## Dashboard layout

Top: firm name, selected month, selected financial year and last
reminder check. Then six large figures: month actual spend, month budget
remaining, annual recurring equivalent, financial year actual spend,
current dues within 30 days and overdue amount.

Middle: an action table with item, due date, amount, payment method,
status and action required. Sort overdue first, then the nearest due
date. Show a separate short list of cancellation decisions so these are
not counted as unpaid amounts.

Bottom: three charts only. Monthly budget versus actual as columns;
monthly actual spending split into Subscriptions, Hardware and Software
as stacked columns; current monthly subscription equivalents by plan as
horizontal bars. All charts must use formula summary ranges and update
when records are added.

## Readability rules

-   White background, navy headings, restrained purple and gold accents.
    Dark text, clear borders, generous rows and no decorative 3D charts.

-   Use 11 or 12 point worksheet text, readable chart labels, frozen
    headers, frozen item names and filters. Avoid merged cells inside
    data tables.

-   Pale yellow means input; pale grey means formula. Use words with
    colours: Overdue, Due soon, Scheduled, Paid, Review required. Never
    rely on colour alone.

Keep essential columns on the left and group optional details on the
right. Add Home links on each sheet and a short instruction line above
every table. The dashboard should print on one landscape page without
shrinking text excessively.

BUILD BRIEF / 03

# Subscriptions: what to record

One row represents one billing account and plan. Separate different
plans or accounts even when the provider is the same. A stable
Subscription ID must not change when the table is sorted.

  -----------------------------------------------------------------------
  **Field group**  **Columns and meaning**
  ---------------- ------------------------------------------------------
  Identity         Subscription ID; Provider / tool; Plan; Purpose;
                   Owner.

  Lifecycle        Status: Active, Trial, Paused or Cancelled; Auto
                   renew: Yes or No; Cancellation deadline, if
                   applicable.

  Billing          Frequency: Monthly, Quarterly, Half yearly, Annual or
                   Custom; Cycle months: 1, 3, 6 or 12 for standard
                   plans; Next payment due date.

  Price            Currency; Total bill per cycle in that currency,
                   including known taxes; Estimated INR exchange rate;
                   Additional INR bank / FX charges per cycle.

  Payment          Payment method; Masked payment reference; Reminder
                   enabled: Yes or No; Optional invoice / provider link;
                   Notes.

  Calculated       Estimated cycle cost INR; Monthly equivalent INR;
                   Annual equivalent INR; Days to due; Payment alert;
                   Cancellation alert.
  -----------------------------------------------------------------------

## Entry conventions

The bill amount is the full amount for the plan and all seats together.
Do not multiply it again by users. For INR, the exchange rate is 1. For
foreign currency, enter INR per unit of that currency and the date of
the estimate in Notes. Keep unknown cost or due date blank and flag
Review required; never silently treat missing cost as zero.

Payment methods: Credit card, Debit card, UPI, Net banking, Bank
transfer or Other. A reference such as "Office card ending 1234" is
sufficient. Do not store full card numbers, CVV, PIN, passwords or API
keys.

## Renewal and trial behaviour

Active plans feed recurring equivalents. Trial, Paused and Cancelled
plans do not. A trial with a known conversion date appears as "Trial
review"; show its prospective paid cost separately from current
recurring spending. Auto renew does not mean paid.

Cancellation deadlines are separate from payment due dates. Turning off
auto renewal does not cancel an outstanding bill. Paused or cancelled
rows with a retained due date stay in the due list until a human
confirms payment or explicitly clears the obligation with a reason.
Custom plans require a manually confirmed next date and a positive cycle
month count if an equivalent is wanted.

BUILD BRIEF / 04

# Investments and payment records

## Investments sheet

Use one row for each one time purchase or separately payable instalment.
Recurring software belongs in Subscriptions. Related instalments can
share a parent reference in Notes; never add both their total and each
instalment as separate costs.

  -----------------------------------------------------------------------
  **Columns**                  **Rules**
  ---------------------------- ------------------------------------------
  Investment ID; Item;         Category is Hardware or Software. Include
  Category; Vendor             an AI workstation, monitor or perpetual
                               licence only when actually entered by the
                               user.

  Purchase / planned date;     Use gross payable cost including known
  Total expected INR           taxes and charges. This is a commitment,
                               not proof of payment.

  Due date; Payment method;    Due date is required for unpaid
  Masked reference             commitments. Leave blank for a wish list
                               item that is not yet committed.

  Status; Invoice link;        Status: Planned, Committed, Paid or
  Warranty end; Notes          Cancelled. Warranty and invoice links are
                               optional.

  Calculated: Days to due;     Only Committed items are counted in dues.
  Payment alert                Planned items stay outside actual spending
                               and payment reminders.
  -----------------------------------------------------------------------

## Payments sheet: the cash record

Columns: Payment ID; Source type (Subscription / Investment); Source ID;
Item name snapshot; Category snapshot; Cycle due date snapshot; Payment
date; Transaction type (Payment / Refund); Actual INR amount; Signed INR
amount (formula); Payment method; Masked reference; Invoice /
transaction reference; Notes; Entered at; Entered by.

Enter Actual INR amount as positive. The signed formula makes refunds
negative. Record the final bank or card debit, including taxes and
charges, rather than the estimated converted cost. Keep item name,
category and due date snapshots fixed so later plan edits do not rewrite
history.

## A simple settlement rule

Version 1 supports full settlement of a subscription cycle or an
investment row. Record Payment asks for the actual amount and payment
date, then confirms that the item is fully settled. An exchange rate
difference does not prevent settlement. For investment instalments,
create separate rows. Subscription part payments require manual handling
outside this basic version.

Refunds reduce actual spend on the refund date and link to the original
record; they do not automatically reopen a paid item. Never record a
planned purchase in Payments until money actually leaves the account.
Historical transactions are entered separately and must not advance
current due dates.

BUILD BRIEF / 05

# Budget and calculation rules

Use cash spending for the budget. Use monthly and annual equivalents
only to compare the recurring cost of plans. These are different views
and must never be added together.

  -----------------------------------------------------------------------
  **Measure**          **Calculation and boundary**
  -------------------- --------------------------------------------------
  Estimated cycle cost ROUND(Total bill × INR exchange rate + Extra INR
  INR                  charges, 2). Blank required inputs produce Review
                       required.

  Monthly equivalent   Estimated cycle cost INR ÷ Cycle months, rounded
                       to two decimals. Active plans only.

  Annual equivalent    Estimated cycle cost INR × 12 ÷ Cycle months,
                       rounded to two decimals. Use the unrounded base;
                       not the rounded monthly figure.

  Actual cash spend    Sum signed Payments by payment date. Refunds
                       reduce spending in the month received.

  Budget remaining     Monthly budget less monthly actual. A negative
                       value means overspent.

  Budget usage         Monthly actual ÷ Monthly budget. If budget is
                       blank, show Not set; if zero with positive spend,
                       show Unbudgeted spend.

  Current dues within  Sum current unpaid subscription cycles and
  30 days              Committed investments due from today through
                       today + 30, inclusive. Exclude overdue amounts.

  Overdue amount       Sum current unpaid obligations with due date
                       before today. Show separately; trial decisions are
                       not unpaid obligations.
  -----------------------------------------------------------------------

## Budget table

One row per month, stored as the first date of that month. Columns:
Month; Subscription budget; Hardware budget; Software budget; Total
budget; Actual subscriptions; Actual hardware; Actual software; Total
actual; Remaining budget; Usage; Status. Allow a genuine zero budget; do
not convert a blank budget into zero.

Selected month and financial year are dashboard filters. The financial
year starts on 1 April and ends before the following 1 April. Annual
budget is the sum of entered monthly category budgets; if any are
missing, label the annual budget incomplete. Do not silently carry
unused monthly budget forward.

The 30 day figure shows the next recorded unpaid cycle per subscription.
It is not a complete future cash forecast or a reconstruction of every
missed bill. A long overdue row must say "Review missed cycles". Total
AI cash investment to date is the sum of signed Payments across the
available history, split by category.

BUILD BRIEF / 06

# Formula examples and daily workflow

The builder must create real worksheet formulas, with a clear mapping of
every named range or table column. These examples show required logic;
convert names to the actual layout for the chosen platform.

## Readable formula patterns

=IF(DueDate=\"\",\"\",DueDate-TODAY())

Days to due. Use actual date values, not text. Status rules must check
missing inputs and lifecycle before comparing this value.

=IF(Type=\"Refund\",-ActualINR,ActualINR)

Signed payment amount. Validate the source amount as positive and the
transaction type against the dropdown.

=SUMIFS(PaymentSignedINR,PaymentDate,\"\>=\"&MonthStart,\
PaymentDate,\"\<\"&EDATE(MonthStart,1))

Actual spend for a month. Add the category criterion for category
totals. Named ranges must have the same dimensions and extend with new
entries.

## Record a payment

-   Select a subscription or committed investment. Review the item,
    current due date, actual amount, method and payment date in a
    compact confirmation dialog.

-   After confirmation, append the payment once. For a subscription,
    advance from the previous scheduled due date by exactly one billing
    cycle; do not advance from the payment date or skip unpaid cycles.
    For an investment, set Paid.

-   Preserve the original billing day and month end rule in protected
    helper fields. Clamp short months without permanently shifting the
    anchor. Custom schedules ask for the next date.

-   Refresh formulas and dashboard. A subscription that remains overdue
    after one cycle advances stays in the action list. Record other
    outstanding cycles separately after checking invoices.

## Edits, cancellations and corrections

Do not move a due date simply because it has passed, because an email
was sent or because auto renewal is enabled. A manual date change or
cleared obligation needs a reason in the action log. Before changing
price or billing frequency, settle or document the treatment of the
current unpaid cycle. Payment corrections require a controlled
correction action with old value, new value and reason, not silent
deletion.

A duplicate safeguard must use Source ID plus the paid cycle due date
for subscriptions, and Investment ID for a full investment settlement.
Historical entry and refund actions must have their own unique IDs. A
failed or retried action must reconcile an existing payment before
advancing any date.

BUILD BRIEF / 07

# Email reminder behaviour

Send a single digest to the configured internal owner when something
needs attention. Email automation starts only after the owner saves a
recipient, previews the email, sends a test and enables reminders.

## Default schedule and contents

Check once daily in the 9 AM to 10 AM Asia/Kolkata window. Trigger
execution time is approximate. Include unpaid items due within the next
7 calendar days, items due today and overdue items. Include trial
conversion and cancellation deadlines in a separate decision section. An
empty digest sends no email. \[1\]

Upcoming and overdue items appear daily until resolved; send at most one
successful production digest per recipient per local date. The 7 day
window and enabled state are Settings values. Long overdue entries show
a missed cycle warning; do not estimate missing invoices silently.

## Reliability and control

-   Use MailApp with an HTML body and a plain text fallback. It can send
    mail without inbox access. Check remaining recipient quota before
    sending; limits depend on account and may change. \[2\]\[3\]

-   Use one designated automation owner. Setup must reuse or replace
    only this tool's matching trigger for that owner, not delete
    unrelated triggers. Document that other users can own separate
    triggers. \[1\]

-   Lock competing executions; write a Pending run record before sending
    and Sent only after MailApp returns successfully. Log errors and
    quota blocks without marking them sent.

-   If a run stops after submission but before its final log, show
    Delivery uncertain and require a human check before retry. No
    spreadsheet solution can promise exactly once email delivery or
    confirmed receipt.

-   Show last check time, last successful submission and latest error on
    Dashboard. A stale check older than 36 hours must display Check
    automation. Check the log weekly and after account changes.

## What goes into the log

Timestamp; Run / action ID; Recipient; Local date; Included source IDs
and due dates; Result (Pending, Sent, Failed, Quota blocked, No items or
Delivery uncertain); Error summary. Controlled payment, cancellation and
date edits also record old value, new value, actor where available and
reason.

The email only asks the owner to review and act. It never initiates a
payment, cancels a service or marks an item paid. "Sent" means accepted
by the mail service, not read or delivered to the inbox.

BUILD BRIEF / 08

# The reminder email

Use a clean white email, navy heading, a restrained gold divider and
legible dark text. Use simple inline styling, no remote images, no
tracking pixels and no attachment. The action link opens the private
spreadsheet and does not change sharing permissions.

## Template wording

Subject: BHV AI Spend Tracker \| Payment review \| {{date}}

Dear {{owner_name}},

Please review the following AI subscription and technology payments. The
amounts are based on the tracker and should be checked against the
relevant invoice or bank debit before payment.

  --------------------------------------------------------------------------
  **Item**              **Due date**   **Amount      **Action**
                                       INR**         
  --------------------- -------------- ------------- -----------------------
  {{item_name}}         {{due_date}}   {{amount}}    {{status / action}}

  --------------------------------------------------------------------------

Payment method: show a masked label below the relevant item or in a
second line within its cell. For auto renewal items, use "Check
available funds and confirm debit". For manual payments, use "Review
invoice and arrange payment".

Overdue total: {{overdue_total}}\
Due within 7 days, including today: {{upcoming_total}}\
Current month actual spending: {{month_actual}}\
Current month budget remaining: {{budget_remaining}}

Cancellation or trial review: {{decision_items_or_omit_section}}

Please update the tracker after confirming payment. If the payment has
already been made, record the actual debit so the reminder can clear.

Open AI Spend Tracker: {{private_sheet_link}}

Regards,\
B H Vyas & Associates\
Internal Technology Administration

Automated internal reminder. Estimated amounts may differ from the final
charge. This email does not confirm payment or authorise a transaction.

## Email rendering rules

The builder replaces all template tokens with live values and omits
empty sections. Use a maximum width near 640 pixels, body text around 15
pixels and compact mobile wrapping. Escape all cell text before
inserting it into HTML. Validate the spreadsheet link and permit only
the owner's configured recipients; never use an email address from an
arbitrary data row.

For a test email, prefix the subject with TEST and state that sample
data is illustrative. A test must not consume the production digest key.
Provide a plain text version with the same information.

BUILD BRIEF / 09

# Setup, access and operating discipline

## Settings to provide

Firm name; Owner name; Recipient email; Optional approved internal CC;
Base currency INR; Timezone Asia/Kolkata; Financial year start month 4;
Reminder enabled (default No); Due soon days (default 7); Daily check
window (default 9 AM); Selected month; Selected financial year; Dropdown
lists. Leave recipient and actual financial data blank until supplied.

## Google Sheets route

Create a private spreadsheet in the firm's Google account. Open
Extensions, then Apps Script; paste the supplied files, run setup and
review the requested permissions. Set the spreadsheet and script
timezone consistently. Enter settings, add records, preview the digest
and send a test. The owner then enables the daily trigger. No web app
deployment is needed. \[1\]\[2\]

Data flow: manual entries from invoices and bank records enter Google
Sheets; formulas produce summaries; the attached script reads eligible
items and submits the digest through MailApp; results return to the log.
Spreadsheet data, script and version history are held in the firm's
Google environment; email copies are stored by the sender's and
recipients' mail services. This is cloud processing, not an offline
tool.

## Excel route

Use an .xlsm workbook in desktop Excel on Windows for the VBA version.
Workbook formulas should remain usable with macros disabled, but setup
and reminder actions require permitted macros. Excel for the web cannot
run VBA. Optional email drafting can target classic Outlook; new Outlook
does not support VBA or macros. A closed workbook cannot provide
dependable VBA reminders on its own. \[4\]\[5\]

## Confidentiality and review

Keep this tracker limited to the firm's own technology spending. Do not
enter client names, PAN, audit evidence or client documents. Restrict
editing to the owner and an authorised administrator, use multifactor
authentication and keep invoice links restricted. Protected ranges
prevent accidental changes; they are not a confidentiality boundary or a
tamperproof audit trail.

The owner reviews new recipients, payments, cancellations and
corrections. Retain invoices and bank evidence separately, reconcile
Payments monthly and keep a monthly restricted backup or approved
version. Exported Excel copies do not carry Apps Script triggers. When
the automation owner changes, the new owner must reauthorise and
recreate the trigger.

This is an internal spending control, not a statutory register, audit
opinion or tax computation. GST credit, withholding obligations,
capitalisation and depreciation require separate professional evaluation
in the firm's books. The design supports confidentiality and review; it
does not certify ICAI or legal compliance.

BUILD BRIEF / 10

# Generation prompt: Google Sheets

Copy the text below into a new chat and attach this Word file. If
attachments are unavailable, paste the full document after the prompt.
This prompt intentionally uses the shared specification rather than
duplicating it.

Build the BHV AI Spend Tracker described in the attached specification
for B H Vyas & Associates. Use Google Sheets with a small attached Apps
Script. Treat pages 2 to 9 as the functional specification and page 12
as the acceptance checklist. Build the working tool and supply complete
code and setup instructions, not another proposal.

Keep six visible sheets: Dashboard, Subscriptions, Investments,
Payments, Budget and Settings. Keep Automation Log hidden but
accessible. Follow the stated light theme, readable tables, six
dashboard figures, action list and three charts. Use real formulas for
costs, recurring equivalents, signed transactions, totals and budget
comparisons. Do not hardcode dashboard results in Apps Script.

Provide the complete Code.gs and appsscript.json; add HTML files only
for the compact payment dialog or email preview where needed. Give every
named function, helper and formula; no pseudocode, missing functions,
TODO sections, paid libraries, external APIs or database. Document the
final column map and named ranges. Scripts must locate data by stable
IDs and headers, not the currently selected row number after sorting.

Provide a BHV AI Tracker menu with Setup / Repair, Record Payment,
Record Historical Payment, Record Refund, Correct Record, Preview
Reminder, Send Test Email, Enable Reminders, Disable Reminders and View
Automation Log. Use the smallest practical dialogs. Record Payment must
preserve history, prevent duplicate settlement and advance only the
confirmed cycle using the original billing anchor.

Make setup repeatable without erasing inputs, Payments, budgets, logs or
unrelated sheets. Create missing owned elements; repair only intended
formulas and formatting. Add validation, protected formulas, filters,
dynamic chart ranges and readable empty states. Reject invalid dates and
missing required amounts. Never silently use zero for missing prices or
budgets. Explain how to expand capacity without losing formulas.

Implement the consolidated email, recipient validation, owner controlled
activation, timezone handling, quota check, execution lock, digest
duplicate safeguard and uncertain delivery recovery specified in this
document. Use MailApp, not inbox scraping. Do not send live email or
activate triggers during generation. Preview and test must precede user
activation. Avoid requesting Drive or Gmail inbox scopes unless an
explicit implemented feature requires them.

Keep the initial workbook empty of real financial data and recipients.
Offer a separate opt in Load Demo Data action using unmistakably
fictional items; it must never enable email. Explain each setup step for
a nontechnical user, permissions, trigger ownership, disabling
reminders, backup and common failures. Provide a short formula map and
the page 12 test results. If you cannot execute Google account tests,
mark those checks unverified and give exact steps for the owner to run
them.

Deliver the code as downloadable files where possible, and the shortest
complete installation guide. If a live spreadsheet can be created with
available authorised tools, also provide its private link. Do not claim
a live Sheet or email schedule exists unless it was actually created and
checked. Do not add features beyond this basic scope.

BUILD BRIEF / 11

# Generation prompt: Excel with VBA

Copy the text below into a new chat and attach this Word file, or paste
the full document after the prompt. Choose this route when desktop Excel
is preferred over cloud email automation.

Build the BHV AI Spend Tracker for B H Vyas & Associates as a basic
desktop Excel workbook using the attached specification. Follow pages 2
to 9 for the shared design and data rules, and page 12 for acceptance.
Apply the Excel differences below. Deliver the working workbook and
complete VBA, not another specification.

Use the same six visible sheets and hidden Automation Log. Use genuine
Excel Tables, dropdowns, frozen headers, conditional formatting,
protected formula columns, clear named ranges and the three stated
charts. Use worksheet formulas for all financial calculations. Avoid
Power Query, Power Pivot, external data connections, paid add ins,
ActiveX controls and a separate application.

Target Microsoft 365 desktop Excel on Windows and label the file .xlsm
only when it contains a valid VBA project. Supply complete standard
modules and any ThisWorkbook event code separately, with clear placement
instructions. Use Option Explicit, reliable date handling and no
unnecessary external references. If generating an embedded VBA project
is unavailable, deliver an honestly labelled .xlsx starter and .bas
modules with exact steps to save as .xlsm and import them; do not simply
rename the file.

Provide worksheet buttons or a simple menu for setup / repair, record
payment, historical payment, refund, correction, reminder preview and
viewing the log. Setup must preserve existing data, and macros must
restore Excel calculation, events and screen updating even after an
error. Detect duplicate payment actions and reconcile incomplete actions
before changing dates.

Keep the payment history, billing anchor, full settlement rule, actual
cash budget and estimate distinctions from the specification. Do not
assume that annual subscriptions are paid monthly. Do not count a
hardware cost twice from both Investments and Payments. Handle refunds
in the cash month received and preserve historical values when
subscription prices change.

For reminders, show the due list when the workbook opens and provide a
manual reminder preview. Email creation is optional and must use classic
Outlook only when installed, with a draft displayed for review before
sending. Detect unavailable Outlook and give a clear fallback. Do not
promise automation while Excel is closed, and do not configure Windows
Task Scheduler or store mail credentials. Excel web and new Outlook are
not the VBA target.

Follow the white, navy, purple and gold design; use readable labels and
figures, no clutter and no decorative 3D charts. Leave actual prices,
budgets and recipient addresses blank. Offer fictional demo data
separately. Provide the workbook or honest starter package, all source
modules, a concise user guide, a formula map and the acceptance results.
Mark any unexecuted Excel or Outlook checks clearly as requiring local
verification.

## Compatibility note

The Google and Excel versions share the data design but use different
automation. An exported Google workbook does not acquire VBA, and a VBA
workbook imported into Google Sheets does not gain Apps Script. Use one
primary version to prevent conflicting records.

BUILD BRIEF / 12

# Acceptance checks and source notes

Run these checks on fictional demo data before entering real
information. The examples below are arithmetic checks, not market prices
or assumed purchases.

  -----------------------------------------------------------------------
  **Check**          **Required result**
  ------------------ ----------------------------------------------------
  Annual plan        INR 24,000 per year shows INR 2,000 monthly
                     equivalent. Its full payment appears only in the
                     month actually paid.

  Cash budget        Hardware 180,000 + subscription 2,000 less refund
                     500 gives INR 181,500 actual. Against INR 200,000,
                     remaining is INR 18,500.

  No double counting A paid investment in both master and Payments
                     contributes once to actual spend. Planned
                     investments contribute zero.

  Date boundaries    Due today is not overdue. Day 7 is in the email
                     window. Day 30 is in the dashboard window. March and
                     April fall into the correct financial years.

  Renewal anchor     A January month end renewal moves to February month
                     end and then March month end. Leap years work. A
                     late payment does not skip cycles.

  History and        Price edits do not alter old payments. Blank dates
  missing data       and unknown costs show Review required. Blank and
                     zero budgets behave differently.

  Email and          Paid items disappear; outstanding cancelled items
  lifecycle          remain until resolved. Trial decisions are separate.
                     An empty digest sends nothing.

  Recovery and       Retry cannot duplicate a settlement or same day
  repeat setup       digest. Uncertain delivery is flagged. Repeated
                     setup preserves all records and unrelated triggers.
  -----------------------------------------------------------------------

Also verify filters after sorting, new row formula coverage, protected
inputs, print layout, chart updates and mobile email rendering. Test
failed authorisation and quota handling in a safe test mode. Record
platform, date, result and any unverified checks.

## Official technical references

Sources checked on 6 September 2026. These support platform
capabilities; the workflow, budget method and controls are design
recommendations. Product behaviour and quotas should be checked again
when implementing.

[\[1\] Google: Installable triggers and account
ownership](https://developers.google.com/apps-script/guides/triggers/installable)

[\[2\] Google: MailApp, HTML messages and remaining
quota](https://developers.google.com/apps-script/reference/mail/mail-app)

[\[3\] Google: Apps Script
quotas](https://developers.google.com/apps-script/guides/services/quotas)

[\[4\] Microsoft: VBA macros in Excel for the
web](https://support.microsoft.com/en-us/excel/work-with-vba-macros-in-excel-for-the-web)

[\[5\] Microsoft: VBA and macro alternatives in new
Outlook](https://learn.microsoft.com/en-us/microsoft-365-apps/outlook/get-started/vba-alternatives)

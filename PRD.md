# Product Requirements Document: Digi-Child Clinical Orchestrator
**Build name**: Digi-Child Clinical Orchestrator (Therapeutic & Logistics Edition)  
**Owner**: Naquan, Mitra, Jimmy  
**Date**: July 7, 2026  

---

## 1. PROBLEM
Clinicians and parents in court-ordered programs experience significant delays and administrative overhead when coordinating mandatory behavioral evaluation sessions, because aligning the erratic schedules of an external parent, a licensed clinician, and a court-appointed monitor creates an extensive "scheduling Tetris" bottleneck. This results in 10–15 hours of staff time wasted per week on logistics rather than active therapy, while delaying critical, risk-free behavioral practice for parents who need to learn to de-escalate real-world child defiance safely.

### Supporting Context
* Manual calendar coordination for multi-person panel reviews routinely drains 10–15 hours a week for administrative and clinical teams.
* Individuals undergoing court-ordered parenting education lack dynamic, real-time feedback loops to practice conflict resolution safely, often compromising long-term parent-child relationship outcomes.
* No existing platform bridges autonomous multi-party calendar orchestration with localized, state-tracked clinical simulation tools.

### 1a. Opportunity
Enable therapeutic networks to completely automate multi-party panel scheduling and immediate digital simulation provisioning, eliminating administrative friction entirely while delivering a standardized, risk-free environment for behavioral evaluation.

### Market Opportunity
* Repetitive, high-volume coordination workflows consume substantial operational budgets within court-ordered and therapeutic care networks.
* This platform provides a secure, clinical-grade digital architecture that replaces passive, lecture-based learning with trackable, behavioral metrics.

### 1b. Users & Needs
* **Primary users**: Parents/Caregivers in court-ordered programs or therapeutic settings who require high-fidelity, hands-on de-escalation practice.
* **Secondary users**: Clinicians, social workers, and court-appointed monitors who assess patient progress and manage session logistics.

### Key User Needs
* **As a parent**, I need a simulation that feels unpredictable and challenging so I can practice responding to genuine behavioral friction rather than theoretical questions.
* **As a clinician**, I need clear data on user input and system response so I can objectively evaluate a patient's progress toward healthy parenting benchmarks.
* **As a clinician**, I need the system to automatically handle session booking and simulation environment setup so I can focus entirely on behavioral evaluation instead of manual calendar logistics.

---

## 2. PROPOSED SOLUTION
Digi-Child Clinical Orchestrator is an AI-native coordination and simulation platform that completely automates multi-party scheduling and provisions controlled digital therapeutic environments. Users simply input or confirm their availability via an automated outreach link, and the system autonomously matches calendars across multiple internal and external parties to book the session. The moment the session is confirmed, the system instantiates the parenting simulation, pre-loading the parent’s historical behavioral data. As a result, clinical teams eliminate the tedious administrative back-and-forth entirely while parents gain seamless access to critical, metric-tracked conflict resolution training.

### 2a. Value Proposition
Clinicians and court-ordered parents who struggle with manual scheduling bottlenecks and abstract classroom lessons use Digi-Child Orchestrator, an integrated scheduling and simulation platform, to autonomously book panel reviews and launch high-fidelity behavioral exercises. Unlike traditional passive lectures or manual calendar coordination, it seamlessly bridges logistical automation with real-time, metric-tracked conflict resolution, helping clinical programs save over 10 hours a week while capturing objective data on patient progress.

### 2b. Top 3 MVP Value Props
1. **The Vitamin (must-have baseline)**: A clinical baseline that mimics standard child developmental phases for consistent evaluation.
2. **The Painkiller (solves the core pain)**: Complete automation of the multi-person panel scheduling bottleneck by autonomously cross-referencing external candidate availability with internal interviewer calendars.
3. **The Steroid (the magic moment)**: Automatic provisioning of the live simulation environment pre-loaded with the parent's historical `state.json` data the exact moment the panel session begins.

### 2c. Goals & Non-Goals
* **Goals**:
  * Provide an automated, self-serve calendar coordination engine for complex multi-party panel scheduling.
  * Track quantifiable metrics (e.g., `trust_level`, `temperament`, `consecutive_mistreatments`) within a centralized data structure for objective assessment.
  * Ensure a secure, controlled simulation environment for behavioral practice in therapeutic and court-ordered contexts.
* **Non-Goals**:
  * Public release or consumer-facing commercial distribution (strictly preserved for prescribed/clinical use).
  * Replacing licensed human oversight; the system acts purely as an administrative and data-tracking support tool, not an automated diagnostic judge.

### 2d. Success Metrics
* **Operational Efficiency**: Time-to-schedule a mandatory multi-person panel session $< 24$ hours from initial intake referral.
* **Staff Time Reclaimed**: Reduction of 80% (saving 10+ hours/week) spent by staff on manual scheduling.
* **De-escalation Proficiency**: Increasing trend of child `trust_level` across 5 consecutive sessions.
* **Behavioral Consistency**: Decreasing trend of `consecutive_mistreatments` frequency per patient portfolio.

---

## 3. REQUIREMENTS

### User Journey 1: Parent practicing behavioral management
* **Context**: The parent must react to the child in a way that prioritizes stability and de-escalation while interacting with the digital child agent.
* **Sub-journey: Responding to behavioral friction**:
  * **[P0]** User can input verbal or written responses to the child agent.
  * **[P0]** System must process the input and update `trust_level` in `state.json`.
  * **[P0]** User can observe the child agent's reaction (e.g., drawing on the wall, saying "no") in the user interface.
  * **[P1]** User can pause the simulation if immediate instruction or clinical intervention is required by the live observer.

### User Journey 2: Clinician evaluating progress and managing logistics
* **Context**: Streamlining administrative scheduling and reviewing simulation metrics to assess therapeutic progress without logistical delays.
* **Sub-journey: Administrative Coordination & Session Launch**:
  * **[P0]** System must autonomously cross-reference external parent availability with internal clinician and court monitor calendars to book multi-person panel evaluation sessions.
  * **[P0]** Upon session confirmation, the system must automatically spin up the simulation UI and instantiate the parent's current `state.json` data history.
  * **[P1]** System must send automated reminders to the parent via email or SMS to minimize session no-shows.
* **Sub-journey: Monitoring system state**:
  * **[P0]** System must record every instance of `consecutive_mistreatments` for clinical review.
  * **[P0]** System must display an accurate history of the child-parent interaction via the history log in `state.json`.

---

## 4. APPENDIX
* **Technical Constraints**: Data must be fully encrypted and handled according to stringent privacy standards required for clinical and court-ordered data handling.
* **Ethical Guidelines**: Any behavioral "friction" triggers within the simulation must be calibrated to ensure they remain age-appropriate and representative of common developmental challenges rather than severe trauma, ensuring the system remains a constructive teaching tool.

---

## 5. AGENTIC ALIGNMENT AUDIT (SATURDAY PRESENTATION PREP)

This section maps our system design directly to the required L2L Agentic Presentation guidelines.

### 5.1 Role & Pain Point
* **Role**: Customer-Success style scheduling and digital therapeutic orchestrator for clinic networks.
* **Core Pain Point**: High staff time overhead (10–15 hours/week) spent matching human interviewer panels manually.
* **Agent Impact**: Instantly maps parent slots with clinician/monitor availability, provisions the simulation sandbox, and begins capturing metric data.

### 5.2 Observe-Decide-Act (ODA) Core Loop
1. **Observe**: Retrieves calendar slots (clinician, monitor, parent), state metrics (Trust, Volatility, Security), and live transcript arrays.
2. **Decide**: Evaluates calendar overlaps to output a matching time slot; calculates the next-state parameters for Mira using live Claude API reasoning.
3. **Act**: Books the session, instantiates the sandbox simulation URL, triggers alert warnings, and downloads clinical reports.

### 5.3 Blast Radius & Human-in-the-Loop Checkpoint
* **Blast Radius Analysis**:
  * *Low-Risk / Reversible*: Scheduling matches are highly reversible (can be rescheduled).
  * *High-Risk / Irreversible*: Subjecting the parent to extreme child defiance scenarios without clinician monitoring, or allowing consecutive abusive dialog patterns to accumulate without therapist feedback.
* **Human-in-the-Loop Checkpoint**:
  * *The Checkpoint*: A live **Pause Simulation** toggle.
  * *Trigger*: When a therapist determines verbal intervention is required or if the patient triggers $\ge 2$ consecutive mistreatments.
  * *Action*: Halts simulation inputs, locks the viewport with a blurred glassmorphic overlay, and stops database updates until manually resumed by the clinician.

### 5.4 Live Demo Plan
* **Input**: An scheduled Oppositional profile session (Initial Trust: 40, Volatility: 75).
* **Expected Output**: 
  1. Clinician generates outreach; booking page opens in new tab.
  2. Booking match launches simulator.
  3. Parent receives de-escalation cautions (audio beep, viewport glow, caution banner) on wall-crayons conflict event (turn 3).
  4. Clinician pauses, intervenes, completes, and downloads the session report.
* **Backup**: Seeded mock session JSON database files and pre-recorded UI flow demonstration video.

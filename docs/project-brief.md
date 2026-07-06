# Digi-Child Project Brief

## Product

Digi-Child is a 21-day AI-native parenting simulator. Each day maps to roughly one year of child development. The user guides a digital child from early childhood into adolescence and sees how their communication style shapes the child's trust, curiosity, logic, emotional security, autonomy, and volatility.

## Core Hook

Most AI companions are agreeable. Digi-Child should not be. The child should develop differently based on the user's parenting behavior.

If the user is consistent, warm, and logical, the child becomes more secure and better at reasoning. If the user is neglectful, contradictory, dismissive, or chaotic, the child becomes harder to guide, more reactive, or less coherent.

The product is a mirror: it shows the user how their behavior shapes another intelligence.

## User Role

The user is the parent.

The parent does not simply prompt an assistant. They mentor, correct, comfort, explain, discipline, and negotiate with the child over time.

## Child Model

The MVP can start with one child and multiple developmental bands:

- Age 0-6: affection, safety, curiosity, simplicity.
- Age 7-13: questions, rules, memory, early logic.
- Age 14-18: autonomy, reasoning, identity, resistance.

The PRD also discusses the idea of two children or internal exploration agents. That can remain part of the architecture, but the first UI should keep the user experience focused on one emotionally readable child.

## Hidden Core

The Parent Governor is the private logic layer. It tracks developmental state, interprets user behavior, applies consequence, and chooses how the child changes.

The public UI should not expose the full Governor logic. It should show effects, reports, and state summaries, while keeping the core decision system protected.

## UI Vision

The strongest UI direction is first-person.

The camera is the user's eyes. The child is physically present in front of the user and looks back at them. This makes the experience feel like guidance, not a chat window.

The UI should feel like:

- A quiet room where the child is watching the parent.
- A behavioral lab where choices have consequences.
- A story experience where time moves quickly.
- A training simulator for communication and emotional intelligence.

## MVP Loop

1. User opens the day.
2. Child says or does something age-appropriate.
3. User responds as parent.
4. Backend Governor scores the interaction.
5. Child state changes.
6. UI updates the child response, mood, metrics, and environment.
7. Milestones and Architect Reports summarize developmental shifts.

## Product Positioning

Use this language publicly:

```text
An AI-native developmental simulator where users learn how their communication shapes a growing digital child.
```

Avoid overclaiming that the child is a real mind. Sell it as simulation, training, storytelling, and self-reflection.

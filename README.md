# Digi-Child Sim

An AI-native behavioral simulation where users mentor a digital entity from birth to pre-adulthood. 

## Project Overview
Digi-Child Sim is an interactive, local-first simulation. The system tracks developmental states including age, trust, and personality traits, which evolve based on the "parent's" (user's) input.

## Architecture
- **/parent**: Contains the simulation loop and governance logic.
- **/child_agent**: Contains the persona-based brain that responds to the user.
- **/shared_data**: Contains the state of the simulation (Note: This directory is ignored by Git to maintain local sovereignty).

## Setup
1. Clone the repository: `git clone https://github.com/jimmyronin/Digi-Child-.git`
2. Initialize your local state: Create a `shared_data/state.json` file with the following structure:
```json
{
  "child_age": 0,
  "trust_level": 100,
  "temperament": "neutral",
  "habits": [],
  "consecutive_mistreatments": 0,
  "history": []
}# Digi-Child-

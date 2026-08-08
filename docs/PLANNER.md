# LLM Reasoning: Aether

## 1. Purpose
The LLM converts unstructured text into structured Commitments.

## 2. CRITICAL PRINCIPLE: LLM IS NOT THE SOURCE OF TRUTH
The LLM must **never** be treated as the final source of truth when an objective external source is available. 
Never implement: *"LLM thinks the user probably fulfilled the commitment."*

**The LLM ONLY:**
- Detects commitments.
- Formalizes deadlines.
- Proposes verification strategies.
- Prompts for missing info (e.g. "What should I use as proof?").

## 3. Subjective Claims
Aether should NOT attempt to judge arbitrary subjective statements ("React is better than Vue"). It must request measurable criteria or reject the claim as non-verifiable.

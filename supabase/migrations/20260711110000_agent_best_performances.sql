-- Migration: Add agent/model best performances view and events timeline helper view.

-- 1. Create a view that represents events along with their chronological previous event.
-- Previous event is defined as the event that closed immediately before this one,
-- ordered by close_time (asc) and created_at (asc) as a tie-breaker.
CREATE OR REPLACE VIEW events_with_previous AS
SELECT
  e.*,
  LAG(e.id) OVER (ORDER BY e.close_time ASC, e.created_at ASC) AS previous_event_id
FROM events e;

COMMENT ON VIEW events_with_previous IS 'Consolidated parent events accompanied by a previous_event_id column referencing the chronologically preceding event (by close_time, then created_at).';
COMMENT ON COLUMN events_with_previous.previous_event_id IS 'The ID of the event that closed immediately before this event, or NULL if this is the first event.';

-- 2. Create the main view for agent best performances.
-- For each model/agent, it selects their single best performance (highest percent_change).
-- It also pulls:
--   - previous_event_id (the event that closed immediately before this best event)
--   - previous_event_name
--   - model_previous_event_id (the previous event that this specific model participated in)
--   - model_previous_event_name
CREATE OR REPLACE VIEW agent_best_performances AS
WITH model_chronology AS (
  -- Rank events for each model chronologically to identify the model's own previous event
  SELECT
    r.model_name,
    r.event_id,
    LAG(r.event_id) OVER (PARTITION BY r.model_name ORDER BY e.close_time ASC, e.created_at ASC) AS model_previous_event_id
  FROM model_event_results r
  JOIN events e ON e.id = r.event_id
  WHERE r.ending_balance IS NOT NULL
),
ranked_performances AS (
  -- Rank performances for each model by percent_change, then ending_balance to resolve ties
  SELECT
    r.model_name,
    r.event_id,
    r.starting_balance,
    r.ending_balance,
    r.percent_change,
    ROW_NUMBER() OVER (PARTITION BY r.model_name ORDER BY r.percent_change DESC NULLS LAST, r.ending_balance DESC NULLS LAST, r.event_id ASC) AS rn
  FROM model_event_results r
  WHERE r.ending_balance IS NOT NULL
)
SELECT
  rp.model_name,
  rp.event_id,
  e_best.event_name AS event_name,
  rp.starting_balance,
  rp.ending_balance,
  rp.percent_change,
  ewp.previous_event_id,
  e_prev.event_name AS previous_event_name,
  mc.model_previous_event_id,
  e_model_prev.event_name AS model_previous_event_name
FROM ranked_performances rp
JOIN events_with_previous ewp ON ewp.id = rp.event_id
JOIN events e_best ON e_best.id = rp.event_id
LEFT JOIN events e_prev ON e_prev.id = ewp.previous_event_id
LEFT JOIN model_chronology mc ON mc.model_name = rp.model_name AND mc.event_id = rp.event_id
LEFT JOIN events e_model_prev ON e_model_prev.id = mc.model_previous_event_id
WHERE rp.rn = 1;

COMMENT ON VIEW agent_best_performances IS 'Tracks the single best performance of each model/agent in relation to an event, including overall and model-specific previous events for learning and context.';
COMMENT ON COLUMN agent_best_performances.model_name IS 'The name of the model/agent.';
COMMENT ON COLUMN agent_best_performances.event_id IS 'The ID of the event where the model achieved its best performance.';
COMMENT ON COLUMN agent_best_performances.event_name IS 'The name of the event where the model achieved its best performance.';
COMMENT ON COLUMN agent_best_performances.starting_balance IS 'The starting balance of the model for this event.';
COMMENT ON COLUMN agent_best_performances.ending_balance IS 'The ending balance of the model for this event.';
COMMENT ON COLUMN agent_best_performances.percent_change IS 'The percentage increase in balance (ending - starting) / starting * 100.';
COMMENT ON COLUMN agent_best_performances.previous_event_id IS 'The ID of the event that closed immediately before this best event, or NULL if none.';
COMMENT ON COLUMN agent_best_performances.previous_event_name IS 'The name of the event that closed immediately before this best event, or NULL if none.';
COMMENT ON COLUMN agent_best_performances.model_previous_event_id IS 'The ID of the event that this specific model participated in immediately before this best event, or NULL if none.';
COMMENT ON COLUMN agent_best_performances.model_previous_event_name IS 'The name of the event that this specific model participated in immediately before this best event, or NULL if none.';

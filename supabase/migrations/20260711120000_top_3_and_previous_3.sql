-- Migration: Upgrade views to support top 3 best lifetime events and previous 3 events.

-- 1. Drop existing views that depend on each other
DROP VIEW IF EXISTS agent_best_performances CASCADE;
DROP VIEW IF EXISTS events_with_previous CASCADE;

-- 2. Recreate events_with_previous to include previous_event_id_1, previous_event_id_2, previous_event_id_3
CREATE OR REPLACE VIEW events_with_previous AS
SELECT
  e.*,
  LAG(e.id, 1) OVER (ORDER BY e.close_time ASC, e.created_at ASC) AS previous_event_id_1,
  LAG(e.id, 2) OVER (ORDER BY e.close_time ASC, e.created_at ASC) AS previous_event_id_2,
  LAG(e.id, 3) OVER (ORDER BY e.close_time ASC, e.created_at ASC) AS previous_event_id_3
FROM events e;

COMMENT ON VIEW events_with_previous IS 'Consolidated parent events accompanied by previous event IDs referencing the chronologically preceding 3 events (by close_time, then created_at).';
COMMENT ON COLUMN events_with_previous.previous_event_id_1 IS 'The ID of the event that closed immediately before this event, or NULL if none.';
COMMENT ON COLUMN events_with_previous.previous_event_id_2 IS 'The ID of the event that closed 2 events before this event, or NULL if none.';
COMMENT ON COLUMN events_with_previous.previous_event_id_3 IS 'The ID of the event that closed 3 events before this event, or NULL if none.';

-- 3. Recreate agent_best_performances to return the top 3 best lifetime events per model
CREATE OR REPLACE VIEW agent_best_performances AS
WITH model_chronology AS (
  SELECT
    r.model_name,
    r.event_id,
    LAG(r.event_id) OVER (PARTITION BY r.model_name ORDER BY e.close_time ASC, e.created_at ASC) AS model_previous_event_id
  FROM model_event_results r
  JOIN events e ON e.id = r.event_id
  WHERE r.ending_balance IS NOT NULL
),
ranked_performances AS (
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
  ewp.previous_event_id_1,
  e_prev1.event_name AS previous_event_name_1,
  ewp.previous_event_id_2,
  e_prev2.event_name AS previous_event_name_2,
  ewp.previous_event_id_3,
  e_prev3.event_name AS previous_event_name_3,
  mc.model_previous_event_id,
  e_model_prev.event_name AS model_previous_event_name,
  rp.rn AS performance_rank
FROM ranked_performances rp
JOIN events_with_previous ewp ON ewp.id = rp.event_id
JOIN events e_best ON e_best.id = rp.event_id
LEFT JOIN events e_prev1 ON e_prev1.id = ewp.previous_event_id_1
LEFT JOIN events e_prev2 ON e_prev2.id = ewp.previous_event_id_2
LEFT JOIN events e_prev3 ON e_prev3.id = ewp.previous_event_id_3
LEFT JOIN model_chronology mc ON mc.model_name = rp.model_name AND mc.event_id = rp.event_id
LEFT JOIN events e_model_prev ON e_model_prev.id = mc.model_previous_event_id
WHERE rp.rn <= 3;

COMMENT ON VIEW agent_best_performances IS 'Tracks the top 3 best performances of each model/agent in relation to an event, including chronological context for learning.';
COMMENT ON COLUMN agent_best_performances.model_name IS 'The name of the model/agent.';
COMMENT ON COLUMN agent_best_performances.event_id IS 'The ID of the event where the model achieved this performance.';
COMMENT ON COLUMN agent_best_performances.event_name IS 'The name of the event where the model achieved this performance.';
COMMENT ON COLUMN agent_best_performances.starting_balance IS 'The starting balance of the model for this event.';
COMMENT ON COLUMN agent_best_performances.ending_balance IS 'The ending balance of the model for this event.';
COMMENT ON COLUMN agent_best_performances.percent_change IS 'The percentage increase in balance (ending - starting) / starting * 100.';
COMMENT ON COLUMN agent_best_performances.previous_event_id_1 IS 'The ID of the event that closed immediately before this event, or NULL if none.';
COMMENT ON COLUMN agent_best_performances.previous_event_name_1 IS 'The name of the event that closed immediately before this event, or NULL if none.';
COMMENT ON COLUMN agent_best_performances.previous_event_id_2 IS 'The ID of the event that closed 2 events before this event, or NULL if none.';
COMMENT ON COLUMN agent_best_performances.previous_event_name_2 IS 'The name of the event that closed 2 events before this event, or NULL if none.';
COMMENT ON COLUMN agent_best_performances.previous_event_id_3 IS 'The ID of the event that closed 3 events before this event, or NULL if none.';
COMMENT ON COLUMN agent_best_performances.previous_event_name_3 IS 'The name of the event that closed 3 events before this event, or NULL if none.';
COMMENT ON COLUMN agent_best_performances.model_previous_event_id IS 'The ID of the event that this specific model participated in immediately before this event, or NULL if none.';
COMMENT ON COLUMN agent_best_performances.model_previous_event_name IS 'The name of the event that this specific model participated in immediately before this event, or NULL if none.';
COMMENT ON COLUMN agent_best_performances.performance_rank IS 'The performance rank of this event for the model (1 is best, up to 3).';

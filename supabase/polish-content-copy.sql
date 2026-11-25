-- Run after quiz-battles.sql to correct the spelling in shared study content.

begin;

update public.quiz_sets
set title = regexp_replace(title, '\mFredrick Taylor\M', 'Frederick Taylor', 'gi'),
    description = regexp_replace(description, '\mFredrick Taylor\M', 'Frederick Taylor', 'gi')
where title ~* '\mFredrick Taylor\M'
   or description ~* '\mFredrick Taylor\M';

update public.quiz_set_questions question
set prompt = regexp_replace(question.prompt, '\mFredrick Taylor\M', 'Frederick Taylor', 'gi'),
    options = (
      select jsonb_agg(
        to_jsonb(regexp_replace(option.value, '\mFredrick Taylor\M', 'Frederick Taylor', 'gi'))
        order by option.ordinality
      )
      from jsonb_array_elements_text(question.options) with ordinality as option(value, ordinality)
    ),
    explanation = regexp_replace(
      question.explanation,
      '\mFredrick Taylor\M',
      'Frederick Taylor',
      'gi'
    )
where question.prompt ~* '\mFredrick Taylor\M'
   or question.options::text ~* '\mFredrick Taylor\M'
   or question.explanation ~* '\mFredrick Taylor\M';

commit;

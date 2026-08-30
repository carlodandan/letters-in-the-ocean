-- A handful of letters so the ocean is never empty on day one.
-- These are marked with author_hash 'seed:v1' so they can be identified,
-- retired, or excluded from statistics later.

INSERT OR IGNORE INTO bottles
  (id, message, root_id, depth, author_hash, status, created_at, approved_at, found_count)
VALUES
  ('seed-01', 'I used to think I was behind. Then my grandmother mentioned she learned to swim at sixty-one. Nobody is timing you.', 'seed-01', 0, 'seed:v1', 'approved', datetime('now', '-34 days'), datetime('now', '-34 days'), 0),
  ('seed-02', 'You don''t have to have everything figured out yet. From where I''m standing, you''re doing better than you think.', 'seed-02', 0, 'seed:v1', 'approved', datetime('now', '-33 days'), datetime('now', '-33 days'), 0),
  ('seed-03', 'Whatever you''re carrying today, I hope tomorrow feels a little lighter. In my experience it does — slowly, and in small amounts, but it does.', 'seed-03', 0, 'seed:v1', 'approved', datetime('now', '-31 days'), datetime('now', '-31 days'), 0),
  ('seed-04', 'Drink some water. Open a window. I know that isn''t the answer, but it has never once made things worse.', 'seed-04', 0, 'seed:v1', 'approved', datetime('now', '-30 days'), datetime('now', '-30 days'), 0),
  ('seed-05', 'The thing I wish someone had told me at twenty-three: almost nobody is thinking about your mistake. They are busy thinking about theirs.', 'seed-05', 0, 'seed:v1', 'approved', datetime('now', '-28 days'), datetime('now', '-28 days'), 0),
  ('seed-06', 'I made it through a year I did not believe I would make it through. If you are somewhere in one of those, I am on the other side of it, waving.', 'seed-06', 0, 'seed:v1', 'approved', datetime('now', '-27 days'), datetime('now', '-27 days'), 0),
  ('seed-07', 'Be careful about deciding who you are based on your worst month.', 'seed-07', 0, 'seed:v1', 'approved', datetime('now', '-25 days'), datetime('now', '-25 days'), 0),
  ('seed-08', 'My dad used to say a bad day is a day, not a verdict. It took me about twenty years to actually hear it.', 'seed-08', 0, 'seed:v1', 'approved', datetime('now', '-24 days'), datetime('now', '-24 days'), 0),
  ('seed-09', 'If you are reading this around three in the morning: everything feels permanent at three in the morning. It isn''t. Go back to sleep if you can.', 'seed-09', 0, 'seed:v1', 'approved', datetime('now', '-22 days'), datetime('now', '-22 days'), 0),
  ('seed-10', 'You are allowed to change your mind about the life you were building.', 'seed-10', 0, 'seed:v1', 'approved', datetime('now', '-21 days'), datetime('now', '-21 days'), 0),
  ('seed-11', 'Someone once sat with me in a hospital corridor for two hours and said almost nothing. It remains the kindest thing anyone has done for me. You can be that for somebody.', 'seed-11', 0, 'seed:v1', 'approved', datetime('now', '-19 days'), datetime('now', '-19 days'), 0),
  ('seed-12', 'The dishes will still be there in ten minutes. Go outside first.', 'seed-12', 0, 'seed:v1', 'approved', datetime('now', '-18 days'), datetime('now', '-18 days'), 0),
  ('seed-13', 'Something small and good happened today — a stranger held a door open with their foot because both their hands were full. I keep thinking about it.', 'seed-13', 0, 'seed:v1', 'approved', datetime('now', '-16 days'), datetime('now', '-16 days'), 0),
  ('seed-14', 'You do not owe anybody an explanation for resting.', 'seed-14', 0, 'seed:v1', 'approved', datetime('now', '-15 days'), datetime('now', '-15 days'), 0),
  ('seed-15', 'I learned this the hard way, so you don''t have to: ask for help earlier than feels reasonable. People generally want to be asked.', 'seed-15', 0, 'seed:v1', 'approved', datetime('now', '-13 days'), datetime('now', '-13 days'), 0),
  ('seed-16', 'Whoever finds this — I hope your back stops aching, your inbox stays quiet, and the person you are waiting on texts you back today.', 'seed-16', 0, 'seed:v1', 'approved', datetime('now', '-12 days'), datetime('now', '-12 days'), 0),
  ('seed-17', 'Forgive yourself for the version of you that didn''t know yet.', 'seed-17', 0, 'seed:v1', 'approved', datetime('now', '-10 days'), datetime('now', '-10 days'), 0),
  ('seed-18', 'There is a particular loneliness that comes with doing something new. It is not evidence that you chose wrong. It is just the sound a beginning makes.', 'seed-18', 0, 'seed:v1', 'approved', datetime('now', '-9 days'), datetime('now', '-9 days'), 0),
  ('seed-19', 'I planted bulbs in October and then forgot about them entirely. They came up anyway. Some of the things you do for yourself work on a delay.', 'seed-19', 0, 'seed:v1', 'approved', datetime('now', '-7 days'), datetime('now', '-7 days'), 0),
  ('seed-20', 'If today was survival, that counts. Put it in the win column and go to bed.', 'seed-20', 0, 'seed:v1', 'approved', datetime('now', '-6 days'), datetime('now', '-6 days'), 0),
  ('seed-21', 'You were somebody''s favourite part of their day recently, and they probably never got round to telling you.', 'seed-21', 0, 'seed:v1', 'approved', datetime('now', '-4 days'), datetime('now', '-4 days'), 0),
  ('seed-22', 'It is okay to want a quieter, smaller life than the one you are supposed to want.', 'seed-22', 0, 'seed:v1', 'approved', datetime('now', '-3 days'), datetime('now', '-3 days'), 0),
  ('seed-23', 'I am frightened that I am falling behind everyone else. I don''t really know why I am telling the ocean this.', 'seed-23', 0, 'seed:v1', 'approved', datetime('now', '-2 days'), datetime('now', '-2 days'), 1);

-- One seeded reply, so the chain structure is exercised from the first request.
INSERT OR IGNORE INTO bottles
  (id, message, parent_id, root_id, depth, author_hash, status, created_at, approved_at, found_count)
VALUES
  ('seed-24', 'You are not behind. Everyone is running a different clock, and most of them are lying about the time. Keep going.', 'seed-23', 'seed-23', 1, 'seed:v1', 'approved', datetime('now', '-1 days'), datetime('now', '-1 days'), 0);

UPDATE bottles SET reply_count = 1 WHERE id = 'seed-23';

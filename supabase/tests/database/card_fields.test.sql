begin;
select plan(4);
select has_column('public', 'people', 'occupation', 'people.occupation есть');
select has_column('public', 'people', 'life_story', 'people.life_story есть');
select has_column('public', 'people_live', 'occupation', 'people_live отдаёт occupation');
select has_column('public', 'people_live', 'life_story', 'people_live отдаёт life_story');
select * from finish();
rollback;

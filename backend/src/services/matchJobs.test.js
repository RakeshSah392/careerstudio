import assert from 'node:assert/strict'
import test from 'node:test'
import { scoreJob } from './matchJobs.js'

const job = {
  title: 'Senior Product Designer',
  location: 'New York',
  remote_type: 'hybrid',
  salary_max: '150000',
  employment_type: 'full-time',
  industry: 'software',
}

test('scores matching role, location, work mode, salary, and job details', () => {
  const result = scoreJob(job, {
    target_roles: ['Product Designer'],
    locations: ['New York'],
    remote_preference: 'hybrid',
    min_salary: 120000,
    employment_types: ['full-time'],
    industries: ['software'],
  })

  assert.equal(result.score, 87)
  assert.deepEqual(result.score_breakdown, {
    role: 67,
    location: 100,
    remote_type: 100,
    salary: 100,
    employment_type: 100,
    industry: 100,
  })
})

test('uses neutral scores when preferences and salary data are absent', () => {
  assert.deepEqual(scoreJob({ ...job, salary_max: null }), {
    score: 50,
    score_breakdown: {
      role: 50,
      location: 50,
      remote_type: 50,
      salary: 50,
      employment_type: 50,
      industry: 50,
    },
  })
})

test('penalizes a job salary range above the preference ceiling', () => {
  const result = scoreJob({ ...job, salary_min: 120000 }, { max_salary: 100000 })
  assert.equal(result.score_breakdown.salary, 0)
})
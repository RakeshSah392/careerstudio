function normalize(value) {
  return String(value ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
}

function roleScore(jobTitle, targetRoles) {
  if (!targetRoles.length) return 50
  const jobWords = new Set(normalize(jobTitle).split(' ').filter(Boolean))
  return Math.round(Math.max(...targetRoles.map((role) => {
    const roleWords = new Set(normalize(role).split(' ').filter(Boolean))
    if (!roleWords.size || !jobWords.size) return 0
    const overlap = [...roleWords].filter((word) => jobWords.has(word)).length
    return overlap / new Set([...roleWords, ...jobWords]).size * 100
  })))
}

export function scoreJob(job, preferences = {}) {
  const targetRoles = preferences.target_roles ?? []
  const locations = preferences.locations ?? []
  const employmentTypes = preferences.employment_types ?? []
  const industries = preferences.industries ?? []
  const role = roleScore(job.title, targetRoles)
  const location = locations.length === 0
    ? 50
    : job.remote_type === 'remote' || locations.some((item) => normalize(item) === normalize(job.location)) ? 100 : 0
  const remoteType = preferences.remote_preference == null || preferences.remote_preference === 'any'
    ? 50
    : preferences.remote_preference === job.remote_type ? 100 : 0
  const hasSalaryPreference = preferences.min_salary != null || preferences.max_salary != null
  const hasJobSalary = job.salary_min != null || job.salary_max != null
  const salary = !hasSalaryPreference || !hasJobSalary
    ? 50
    : (preferences.min_salary == null || job.salary_max == null || Number(job.salary_max) >= Number(preferences.min_salary))
      && (preferences.max_salary == null || job.salary_min == null || Number(job.salary_min) <= Number(preferences.max_salary))
      ? 100
      : 0
  const employment = employmentTypes.length === 0
    ? 50
    : employmentTypes.some((item) => normalize(item) === normalize(job.employment_type)) ? 100 : 0
  const industry = industries.length === 0
    ? 50
    : industries.some((item) => normalize(item) === normalize(job.industry)) ? 100 : 0

  const scores = { role, location, remote_type: remoteType, salary, employment_type: employment, industry }
  const score = Math.round(role * 0.4 + location * 0.2 + remoteType * 0.15 + salary * 0.15 + employment * 0.05 + industry * 0.05)
  return { score, score_breakdown: scores }
}
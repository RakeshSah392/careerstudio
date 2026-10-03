import { useEffect, useRef, useState } from 'react'
import {
  ArrowUpRight,
  ArrowLeft,
  Bell,
  Bot,
  BriefcaseBusiness,
  Building2,
  Camera,
  Check,
  CheckCircle2,
  ChevronDown,
  CircleHelp,
  Clock3,
  ExternalLink,
  Eye,
  FileDown,
  FileText,
  LayoutDashboard,
  LoaderCircle,
  LogOut,
  Mail,
  MessageSquare,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Send,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Trash2,
  Bookmark,
  Banknote,
  MapPin,
  XCircle,
  Upload,
  UserRound,
  Users,
} from 'lucide-react'
import './Workspace.css'

const stages = ['Saved', 'Applied', 'Interview', 'Offer', 'Rejected']
const PRESET_RAG_QUESTIONS = [
  'Why am I a good fit for this job?',
  'What are my biggest skill or experience gaps for this role?',
  'How can I improve my resume for this specific position?',
  'What interview topics should I prepare for based on my background and this job?',
]
const todayLabel = new Intl.DateTimeFormat('en-US', {
  weekday: 'long',
  month: 'long',
  day: 'numeric',
}).format(new Date())

async function requestApplications() {
  const response = await fetch('/api/applications', { credentials: 'include' })
  if (response.status === 401) throw Object.assign(new Error('Sign in to view your applications.'), { status: 401 })
  if (!response.ok) throw new Error('Could not load applications')
  return response.json()
}

async function requestOpenJobs(query = '') {
  const params = new URLSearchParams({ status: 'open' })
  if (query.trim()) params.set('q', query.trim())
  const response = await fetch(`/api/jobs?${params.toString()}`)
  if (!response.ok) throw new Error('Could not load open jobs')
  return response.json()
}

async function requestDiscoveryJobs({
  keywords = '',
  location = '',
  workMode = 'any',
  employmentType = 'any',
  minSalary = '',
  source = 'all',
  country = 'in',
  page = 1,
  sort = 'best_match',
} = {}) {
  const params = new URLSearchParams()
  if (keywords.trim()) params.set('keywords', keywords.trim())
  if (location.trim()) params.set('location', location.trim())
  if (workMode && workMode !== 'Any') params.set('work_mode', workMode.toLowerCase())
  if (employmentType && employmentType !== 'Any') params.set('employment_type', employmentType.toLowerCase())
  if (minSalary && Number(minSalary) > 0) params.set('min_salary', minSalary)
  if (source && source !== 'all') params.set('source', source)
  if (country) params.set('country', country)
  params.set('page', String(page))
  params.set('results_per_page', '15')
  params.set('sort', sort === 'Latest Posted' ? 'latest' : 'best_match')

  const response = await fetch(`/api/jobs/discovery?${params.toString()}`, { credentials: 'include' })
  if (!response.ok) throw new Error('Could not load unified jobs.')
  return response.json()
}


function getInitials(name = '') {
  return name.trim().split(/\s+/).slice(0, 2).map((part) => part[0]).join('').toUpperCase() || 'JD'
}

async function readApiResponse(response) {
  try {
    return await response.json()
  } catch {
    return {}
  }
}

function ProfileSection({ user, onUserUpdated, onBack, onOpenEmployer }) {
  const [profile, setProfile] = useState(user)
  const [profileLoading, setProfileLoading] = useState(true)
  const [profileError, setProfileError] = useState('')
  const [name, setName] = useState(user?.full_name ?? '')
  const [editingName, setEditingName] = useState(false)
  const [savingName, setSavingName] = useState(false)
  const [nameMessage, setNameMessage] = useState('')
  const [nameError, setNameError] = useState('')
  const [selectedFile, setSelectedFile] = useState(null)
  const [previewUrl, setPreviewUrl] = useState('')
  const [uploadProgress, setUploadProgress] = useState(0)
  const [uploading, setUploading] = useState(false)
  const [photoError, setPhotoError] = useState('')
  const [photoMessage, setPhotoMessage] = useState('')
  const [confirmRemove, setConfirmRemove] = useState(false)
  const [removingPhoto, setRemovingPhoto] = useState(false)
  const fileInput = useRef(null)

  useEffect(() => {
    let active = true
    fetch('/api/users/me', { credentials: 'include' })
      .then(async (response) => {
        const result = await readApiResponse(response)
        if (!response.ok) throw new Error(result.error ?? 'Could not load your profile.')
        return result
      })
      .then((result) => {
        if (!active) return
        setProfile(result)
        setName(result.full_name ?? '')
        onUserUpdated(result)
      })
      .catch((error) => {
        if (active) setProfileError(error.message || 'Could not load your profile.')
      })
      .finally(() => {
        if (active) setProfileLoading(false)
      })
    return () => { active = false }
  }, [onUserUpdated])

  useEffect(() => () => {
    if (previewUrl.startsWith('blob:')) URL.revokeObjectURL(previewUrl)
  }, [previewUrl])

  const profileImageUrl = previewUrl || (profile?.avatar_storage_key
    ? `${profile.profile_image_url ?? '/api/users/me/avatar'}?v=${encodeURIComponent(profile.updated_at ?? '')}`
    : '')

  function choosePhoto(event) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
      setPhotoError('Choose a JPEG, PNG, or WebP image.')
      setPhotoMessage('')
      return
    }
    if (file.size > 5 * 1024 * 1024) {
      setPhotoError('Choose an image smaller than 5 MB.')
      setPhotoMessage('')
      return
    }
    setSelectedFile(file)
    setPreviewUrl(URL.createObjectURL(file))
    setPhotoError('')
    setPhotoMessage('Previewing selected image. Save to apply it to your profile.')
    setUploadProgress(0)
  }

  function cancelPhoto() {
    setSelectedFile(null)
    setPreviewUrl('')
    setPhotoError('')
    setPhotoMessage('')
    setUploadProgress(0)
  }

  async function savePhoto() {
    if (!selectedFile) return
    setUploading(true)
    setUploadProgress(0)
    setPhotoError('')
    setPhotoMessage('')
    try {
      const data = await new Promise((resolve, reject) => {
        const form = new FormData()
        form.append('image', selectedFile, selectedFile.name)
        const xhr = new XMLHttpRequest()
        xhr.open('POST', '/api/users/me/avatar')
        xhr.withCredentials = true
        xhr.upload.addEventListener('progress', (event) => {
          if (event.lengthComputable) setUploadProgress(Math.round((event.loaded / event.total) * 100))
        })
        xhr.onload = () => {
          let result = {}
          try { result = JSON.parse(xhr.responseText || '{}') } catch {}
          if (xhr.status >= 200 && xhr.status < 300) resolve(result)
          else reject(new Error(result.error ?? 'Could not upload your profile photo.'))
        }
        xhr.onerror = () => reject(new Error('Upload failed. Check your connection and try again.'))
        xhr.send(form)
      })
      setProfile(data)
      setSelectedFile(null)
      setPreviewUrl('')
      setUploadProgress(100)
      setPhotoMessage('Profile photo updated.')
      onUserUpdated(data)
    } catch (error) {
      setPhotoError(error.message || 'Could not upload your profile photo.')
    } finally {
      setUploading(false)
    }
  }

  async function removePhoto() {
    setRemovingPhoto(true)
    setPhotoError('')
    setPhotoMessage('')
    try {
      const response = await fetch('/api/users/me/avatar', { method: 'DELETE', credentials: 'include' })
      const result = await readApiResponse(response)
      if (!response.ok) throw new Error(result.error ?? 'Could not remove your profile photo.')
      setProfile(result)
      setConfirmRemove(false)
      setPhotoMessage('Profile photo removed.')
      onUserUpdated(result)
    } catch (error) {
      setPhotoError(error.message || 'Could not remove your profile photo.')
    } finally {
      setRemovingPhoto(false)
    }
  }

  async function saveName(event) {
    event.preventDefault()
    const trimmedName = name.trim()
    if (!trimmedName) {
      setNameError('Name cannot be empty.')
      return
    }
    setSavingName(true)
    setNameError('')
    setNameMessage('')
    try {
      const response = await fetch('/api/users/me', {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ full_name: trimmedName }),
      })
      const result = await readApiResponse(response)
      if (!response.ok) throw new Error(result.error ?? 'Could not save your name.')
      setProfile(result)
      setName(result.full_name)
      setEditingName(false)
      setNameMessage('Profile details saved.')
      onUserUpdated(result)
    } catch (error) {
      setNameError(error.message || 'Could not save your name.')
    } finally {
      setSavingName(false)
    }
  }

  const roleLabel = profile?.role === 'employer' ? 'Employer' : profile?.role === 'recruiter' ? 'Recruiter' : 'Job Seeker'
  const isEmployerRole = profile?.role === 'employer' || profile?.role === 'recruiter'

  return (
    <section className="profile-view" aria-labelledby="profile-title">
      <header className="profile-page-heading">
        <div>
          <div className="section-kicker">ACCOUNT</div>
          <h1 id="profile-title">Your profile</h1>
          <p className="welcome-subtitle">Manage your identity and profile photo.</p>
        </div>
        <button className="secondary-button profile-back" type="button" onClick={onBack}><ArrowLeft size={15} /> Back to overview</button>
      </header>

      {profileLoading && <div className="profile-loading" role="status"><LoaderCircle className="spin" size={17} /> Loading profile</div>}
      {profileError && <div className="profile-alert" role="alert"><CircleHelp size={16} /> {profileError}</div>}

      {!profileLoading && profile && <>
        <section className="profile-photo-section" aria-labelledby="photo-heading">
          <div className="profile-photo-preview">
            {profileImageUrl
              ? <img src={profileImageUrl} alt={`${profile.full_name}'s profile`} />
              : <span>{getInitials(profile.full_name)}</span>}
          </div>
          <div className="profile-photo-copy">
            <div className="section-kicker">PROFILE PHOTO</div>
            <h2 id="photo-heading">Make it yours</h2>
            <p>JPEG, PNG, or WebP. Maximum 5 MB.</p>
            <input ref={fileInput} className="visually-hidden" type="file" accept="image/jpeg,image/png,image/webp" onChange={choosePhoto} />
            <div className="profile-photo-actions">
              <button className="secondary-button" type="button" onClick={() => fileInput.current?.click()} disabled={uploading || removingPhoto}>
                <Camera size={15} /> {profile.avatar_storage_key ? 'Change photo' : 'Upload photo'}
              </button>
              {profile.avatar_storage_key && !selectedFile && <button className="remove-photo-button" type="button" onClick={() => setConfirmRemove(true)} disabled={removingPhoto}>Remove</button>}
            </div>
            {selectedFile && <div className="photo-save-actions">
              <button className="primary-button" type="button" onClick={savePhoto} disabled={uploading}>
                {uploading ? <><LoaderCircle className="spin" size={15} /> Uploading</> : <><Check size={15} /> Save photo</>}
              </button>
              <button className="secondary-button" type="button" onClick={cancelPhoto} disabled={uploading}>Cancel</button>
            </div>}
            {uploading && <div className="upload-progress" role="progressbar" aria-label="Photo upload progress" aria-valuemin="0" aria-valuemax="100" aria-valuenow={uploadProgress}>
              <div className="upload-progress-track"><span style={{ width: `${uploadProgress}%` }} /></div>
              <span>{uploadProgress}%</span>
            </div>}
            {confirmRemove && <div className="remove-confirm" role="group" aria-label="Confirm photo removal">
              <span>Remove your current profile photo?</span>
              <button className="remove-confirm-action" type="button" onClick={removePhoto} disabled={removingPhoto}>{removingPhoto ? 'Removing…' : 'Remove photo'}</button>
              <button className="remove-cancel-action" type="button" onClick={() => setConfirmRemove(false)} disabled={removingPhoto}>Keep it</button>
            </div>}
            {photoError && <p className="profile-form-error" role="alert">{photoError}</p>}
            {photoMessage && <p className="profile-form-success" role="status">{photoMessage}</p>}
          </div>
        </section>

        <section className="profile-details-section" aria-labelledby="details-heading">
          <div className="profile-section-heading">
            <div><div className="section-kicker">PERSONAL INFORMATION</div><h2 id="details-heading">Account details</h2></div>
            {!editingName && <button className="text-button" type="button" onClick={() => { setEditingName(true); setNameError(''); setNameMessage('') }}><Pencil size={14} /> Edit name</button>}
          </div>
          {editingName ? <form className="profile-name-form" onSubmit={saveName}>
            <label htmlFor="profile-full-name">Full name</label>
            <input id="profile-full-name" autoComplete="name" value={name} onChange={(event) => setName(event.target.value)} maxLength="160" required />
            {nameError && <p className="profile-form-error" role="alert">{nameError}</p>}
            {nameMessage && <p className="profile-form-success" role="status">{nameMessage}</p>}
            <div className="profile-name-actions">
              <button className="primary-button" type="submit" disabled={savingName}>{savingName ? <><LoaderCircle className="spin" size={15} /> Saving</> : <><Check size={15} /> Save changes</>}</button>
              <button className="secondary-button" type="button" onClick={() => { setEditingName(false); setName(profile.full_name); setNameError(''); setNameMessage('') }} disabled={savingName}>Cancel</button>
            </div>
          </form> : <div className="profile-details-grid">
            <div className="profile-detail"><span>Name</span><strong>{profile.full_name}</strong></div>
            <div className="profile-detail"><span>Email</span><strong>{profile.email}</strong></div>
            <div className="profile-detail"><span>Account role</span><strong className={`role-badge role-${profile.role || 'job_seeker'}`}>{roleLabel}</strong></div>
            <div className="profile-detail"><span>Account status</span><strong className="verified-status"><CheckCircle2 size={15} /> Verified</strong></div>
            {nameMessage && <p className="profile-form-success" role="status">{nameMessage}</p>}
          </div>}
        </section>

        <section className="profile-employer-card" aria-labelledby="employer-card-heading">
          <div className="profile-section-heading">
            <div>
              <div className="section-kicker">HIRING & RECRUITING</div>
              <h2 id="employer-card-heading">{isEmployerRole ? 'Recruiter Workspace' : 'Are you hiring?'}</h2>
            </div>
          </div>
          <div className="employer-card-body">
            <div className="employer-card-info">
              <span className="employer-card-icon"><Building2 size={20} /></span>
              <div>
                <strong>{isEmployerRole ? 'Recruiter Profile Active' : 'Create a Recruiter Profile'}</strong>
                <p>
                  {isEmployerRole
                    ? 'Manage your organization profile, recruiting team contacts, and hiring preferences.'
                    : 'Set up a recruiter profile to post jobs, manage candidate pipelines, and find top talent.'}
                </p>
              </div>
            </div>
            <button className="primary-button employer-action-btn" type="button" onClick={onOpenEmployer}>
              <Building2 size={15} />
              <span>{isEmployerRole ? 'Open Recruiter Workspace' : 'Create Recruiter Profile'}</span>
            </button>
          </div>
        </section>
      </>}
    </section>
  )
}

function ApplicationProfileSection({ user: _user, onBack, onOpenResume }) {
  const [activeTab, setActiveTab] = useState('basic')
  const [loading, setLoading] = useState(true)
  const [savingProfile, setSavingProfile] = useState(false)
  const [savingAutoApply, setSavingAutoApply] = useState(false)
  const [profileError, setProfileError] = useState('')
  const [profileSuccess, setProfileSuccess] = useState('')
  const [autoApplyError, setAutoApplyError] = useState('')
  const [autoApplySuccess, setAutoApplySuccess] = useState('')
  const [completeness, setCompleteness] = useState({ score: 0, percentage: 0, missing_fields: [], is_complete: false, has_resume: false })
  const [queueSummary, setQueueSummary] = useState({ queued: 0, processing: 0, applied: 0, failed: 0, blocked: 0 })
  const [queueItems, setQueueItems] = useState([])
  const [evaluatingQueue, setEvaluatingQueue] = useState(false)
  const [evaluationResult, setEvaluationResult] = useState(null)
  const [autoApplyStatus, setAutoApplyStatus] = useState(null)

  const [form, setForm] = useState({
    headline: '',
    current_job_title: '',
    professional_introduction: '',
    skills: '',
    experience_level: 'mid',
    years_of_experience: '',
    joining_status: '30_days',
    notice_period_days: '30',
    available_from: '',
    willing_to_relocate: false,
    expected_salary: '',
    minimum_acceptable_salary: '',
    salary_currency: 'USD',
    salary_period: 'annual',
    preferred_roles: '',
    preferred_locations: '',
    remote_preference: 'any',
    employment_types: ['full-time'],
    preferred_industries: '',
    work_authorization: 'US Citizen / Authorized to work',
    shift_availability: 'day',
    relocation_preference: 'none',
    custom_answers: [],
  })

  const [autoApply, setAutoApply] = useState({
    enabled: false,
    minimum_match_percentage: 80,
    allowed_job_sources: ['direct', 'recruiter'],
    allowed_employment_types: ['full-time', 'contract'],
    allowed_work_modes: ['remote', 'hybrid'],
    require_resume: true,
    require_complete_profile: true,
  })

  const [newQuestion, setNewQuestion] = useState('')
  const [newAnswer, setNewAnswer] = useState('')

  useEffect(() => {
    let active = true
    async function loadData() {
      setLoading(true)
      try {
        const [profileRes, autoApplyRes, statusRes, queueRes] = await Promise.all([
          fetch('/api/application-profile', { credentials: 'include' }),
          fetch('/api/auto-apply', { credentials: 'include' }),
          fetch('/api/auto-apply/status', { credentials: 'include' }),
          fetch('/api/auto-apply/queue', { credentials: 'include' }),
        ])

        if (profileRes.ok) {
          const pData = await readApiResponse(profileRes)
          if (active && pData.profile) {
            const p = pData.profile
            setForm({
              headline: p.headline || '',
              current_job_title: p.current_job_title || '',
              professional_introduction: p.professional_introduction || '',
              skills: Array.isArray(p.skills) ? p.skills.join(', ') : (p.skills || ''),
              experience_level: p.experience_level || 'mid',
              years_of_experience: p.years_of_experience != null ? String(p.years_of_experience) : '',
              joining_status: p.joining_status || '30_days',
              notice_period_days: p.notice_period_days != null ? String(p.notice_period_days) : '30',
              available_from: p.available_from ? p.available_from.substring(0, 10) : '',
              willing_to_relocate: Boolean(p.willing_to_relocate),
              expected_salary: p.expected_salary != null ? String(p.expected_salary) : '',
              minimum_acceptable_salary: p.minimum_acceptable_salary != null ? String(p.minimum_acceptable_salary) : '',
              salary_currency: p.salary_currency || 'USD',
              salary_period: p.salary_period || 'annual',
              preferred_roles: Array.isArray(p.preferred_roles) ? p.preferred_roles.join(', ') : (p.preferred_roles || ''),
              preferred_locations: Array.isArray(p.preferred_locations) ? p.preferred_locations.join(', ') : (p.preferred_locations || ''),
              remote_preference: p.remote_preference || 'any',
              employment_types: Array.isArray(p.employment_types) ? p.employment_types : ['full-time'],
              preferred_industries: Array.isArray(p.preferred_industries) ? p.preferred_industries.join(', ') : (p.preferred_industries || ''),
              work_authorization: p.work_authorization || '',
              shift_availability: p.shift_availability || 'day',
              relocation_preference: p.relocation_preference || 'none',
              custom_answers: Array.isArray(p.custom_answers)
                ? p.custom_answers
                : (p.custom_answers && typeof p.custom_answers === 'object'
                    ? Object.entries(p.custom_answers).map(([q, a]) => ({ question: q, answer: a }))
                    : []),
            })
          }
          if (active && pData.completeness) {
            setCompleteness(pData.completeness)
          }
        }

        if (autoApplyRes.ok) {
          const aData = await readApiResponse(autoApplyRes)
          if (active && aData.settings) {
            const s = aData.settings
            setAutoApply({
              enabled: Boolean(s.enabled),
              minimum_match_percentage: s.minimum_match_percentage != null ? Number(s.minimum_match_percentage) : 80,
              allowed_job_sources: Array.isArray(s.allowed_job_sources) ? s.allowed_job_sources : ['direct', 'recruiter'],
              allowed_employment_types: Array.isArray(s.allowed_employment_types) ? s.allowed_employment_types : ['full-time', 'contract'],
              allowed_work_modes: Array.isArray(s.allowed_work_modes) ? s.allowed_work_modes : ['remote', 'hybrid'],
              require_resume: s.require_resume !== false,
              require_complete_profile: s.require_complete_profile !== false,
            })
          }
        }

        if (statusRes.ok) {
          const stData = await readApiResponse(statusRes)
          if (active) {
            setAutoApplyStatus(stData)
            if (stData.queueSummary) setQueueSummary(stData.queueSummary)
          }
        }

        if (queueRes.ok) {
          const qData = await readApiResponse(queueRes)
          if (active && Array.isArray(qData.queue)) {
            setQueueItems(qData.queue)
          }
        }
      } catch (err) {
        if (active) setProfileError(err.message || 'Could not load application profile.')
      } finally {
        if (active) setLoading(false)
      }
    }
    loadData()
    return () => { active = false }
  }, [])

  async function handleEvaluateJobs() {
    setEvaluatingQueue(true)
    setAutoApplyError('')
    try {
      const res = await fetch('/api/auto-apply/evaluate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
      })
      const data = await readApiResponse(res)
      if (!res.ok) throw new Error(data.error || 'Failed to evaluate open jobs.')
      setEvaluationResult(data)
    } catch (err) {
      setAutoApplyError(err.message || 'Evaluation failed.')
    } finally {
      setEvaluatingQueue(false)
    }
  }

  function handleInputChange(field, value) {
    setForm((prev) => ({ ...prev, [field]: value }))
  }

  function handleCheckboxArrayToggle(field, value) {
    setForm((prev) => {
      const current = prev[field] || []
      const exists = current.includes(value)
      return {
        ...prev,
        [field]: exists ? current.filter((x) => x !== value) : [...current, value],
      }
    })
  }

  function handleAutoApplyArrayToggle(field, value) {
    setAutoApply((prev) => {
      const current = prev[field] || []
      const exists = current.includes(value)
      return {
        ...prev,
        [field]: exists ? current.filter((x) => x !== value) : [...current, value],
      }
    })
  }

  function handleAddCustomQA() {
    if (!newQuestion.trim() || !newAnswer.trim()) return
    setForm((prev) => ({
      ...prev,
      custom_answers: [...prev.custom_answers, { question: newQuestion.trim(), answer: newAnswer.trim() }],
    }))
    setNewQuestion('')
    setNewAnswer('')
  }

  function handleRemoveCustomQA(index) {
    setForm((prev) => ({
      ...prev,
      custom_answers: prev.custom_answers.filter((_, i) => i !== index),
    }))
  }

  async function handleSaveProfile(e) {
    if (e) e.preventDefault()
    setSavingProfile(true)
    setProfileError('')
    setProfileSuccess('')

    const parseArray = (str) =>
      typeof str === 'string'
        ? str.split(',').map((s) => s.trim()).filter(Boolean)
        : Array.isArray(str)
        ? str
        : []

    const payload = {
      headline: form.headline.trim() || null,
      current_job_title: form.current_job_title.trim() || null,
      professional_introduction: form.professional_introduction.trim() || null,
      skills: parseArray(form.skills),
      experience_level: form.experience_level || 'mid',
      years_of_experience: form.years_of_experience === '' ? null : Number(form.years_of_experience),
      joining_status: form.joining_status || '30_days',
      notice_period_days: form.notice_period_days === '' ? null : Number(form.notice_period_days),
      available_from: form.available_from || null,
      willing_to_relocate: Boolean(form.willing_to_relocate),
      expected_salary: form.expected_salary === '' ? null : Number(form.expected_salary),
      minimum_acceptable_salary: form.minimum_acceptable_salary === '' ? null : Number(form.minimum_acceptable_salary),
      salary_currency: form.salary_currency ? form.salary_currency.toUpperCase() : 'USD',
      salary_period: form.salary_period || 'annual',
      preferred_roles: parseArray(form.preferred_roles),
      preferred_locations: parseArray(form.preferred_locations),
      remote_preference: form.remote_preference || 'any',
      employment_types: Array.isArray(form.employment_types) ? form.employment_types : ['full-time'],
      preferred_industries: parseArray(form.preferred_industries),
      work_authorization: form.work_authorization.trim() || null,
      shift_availability: form.shift_availability || 'day',
      relocation_preference: form.relocation_preference || 'none',
      custom_answers: form.custom_answers || [],
    }

    try {
      const response = await fetch('/api/application-profile', {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const result = await readApiResponse(response)
      if (!response.ok) throw new Error(result.error || 'Failed to save application profile.')

      if (result.completeness) {
        setCompleteness(result.completeness)
      }
      setProfileSuccess('Application profile saved successfully.')
    } catch (err) {
      setProfileError(err.message || 'Error saving application profile.')
    } finally {
      setSavingProfile(false)
    }
  }

  async function handleSaveAutoApply(e) {
    if (e) e.preventDefault()
    setSavingAutoApply(true)
    setAutoApplyError('')
    setAutoApplySuccess('')

    const payload = {
      enabled: Boolean(autoApply.enabled),
      minimum_match_percentage: Number(autoApply.minimum_match_percentage) || 80,
      allowed_job_sources: autoApply.allowed_job_sources,
      allowed_employment_types: autoApply.allowed_employment_types,
      allowed_work_modes: autoApply.allowed_work_modes,
      require_resume: Boolean(autoApply.require_resume),
      require_complete_profile: Boolean(autoApply.require_complete_profile),
    }

    try {
      const response = await fetch('/api/auto-apply', {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const result = await readApiResponse(response)
      if (!response.ok) throw new Error(result.error || 'Failed to update auto-apply settings.')

      setAutoApplySuccess('Auto-apply settings updated successfully.')
    } catch (err) {
      setAutoApplyError(err.message || 'Error updating auto-apply settings.')
    } finally {
      setSavingAutoApply(false)
    }
  }

  const score = completeness.percentage || completeness.score || 0
  const scoreTone = score >= 80 ? 'high' : score >= 50 ? 'medium' : 'low'

  const formatMissingField = (name) => {
    return name
      .replace(/_/g, ' ')
      .replace(/\b\w/g, (c) => c.toUpperCase())
  }

  return (
    <section className="app-profile-view" aria-labelledby="app-profile-title">
      <header className="profile-page-heading">
        <div>
          <div className="section-kicker">APPLICATION PROFILE & AUTO-APPLY</div>
          <h1 id="app-profile-title">Application Preferences</h1>
          <p className="welcome-subtitle">
            Configure your professional details, salary requirements, screening answers, and automated application preferences.
          </p>
        </div>
        <button className="secondary-button profile-back" type="button" onClick={onBack}>
          <ArrowLeft size={15} /> Back to overview
        </button>
      </header>

      {/* COMPLETENESS HEADER CARD */}
      <section className="app-profile-completeness-card" aria-label="Profile completeness overview">
        <div className="completeness-header-row">
          <div className="completeness-info">
            <div className="completeness-score-badge">
              <span className={`score-circle score-${scoreTone}`}>{score}%</span>
              <div>
                <strong>Profile Completeness</strong>
                <span className="completeness-subtitle">
                  {score >= 80
                    ? 'Your profile is ready for high-precision matching and auto-apply.'
                    : 'Complete more sections to unlock accurate matching and automated applications.'}
                </span>
              </div>
            </div>
          </div>
          <div className="completeness-resume-status">
            {completeness.has_resume ? (
              <span className="resume-badge-ok">
                <CheckCircle2 size={14} /> Primary Resume Connected
              </span>
            ) : (
              <div className="resume-badge-warn">
                <CircleHelp size={14} />
                <span>No Primary Resume Uploaded</span>
                <button type="button" onClick={onOpenResume} className="link-action-btn">
                  Upload Resume &rarr;
                </button>
              </div>
            )}
          </div>
        </div>

        <div className="completeness-bar-track" role="progressbar" aria-valuenow={score} aria-valuemin={0} aria-valuemax={100}>
          <div className={`completeness-bar-fill score-fill-${scoreTone}`} style={{ width: `${score}%` }} />
        </div>

        {completeness.missing_fields && completeness.missing_fields.length > 0 && (
          <div className="missing-fields-row">
            <span className="missing-fields-label">Suggested next fields to complete:</span>
            <div className="missing-pills-list">
              {completeness.missing_fields.slice(0, 6).map((field) => (
                <span key={field} className="missing-pill">
                  + {formatMissingField(field)}
                </span>
              ))}
            </div>
          </div>
        )}
      </section>

      {/* SUB-TABS NAVIGATION */}
      <nav className="app-profile-subtabs" role="tablist" aria-label="Application Profile Tabs">
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'basic'}
          className={activeTab === 'basic' ? 'app-subtab active' : 'app-subtab'}
          onClick={() => setActiveTab('basic')}
        >
          Professional Info
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'logistics'}
          className={activeTab === 'logistics' ? 'app-subtab active' : 'app-subtab'}
          onClick={() => setActiveTab('logistics')}
        >
          Availability & Logistics
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'salary'}
          className={activeTab === 'salary' ? 'app-subtab active' : 'app-subtab'}
          onClick={() => setActiveTab('salary')}
        >
          Salary & Target Pay
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'preferences'}
          className={activeTab === 'preferences' ? 'app-subtab active' : 'app-subtab'}
          onClick={() => setActiveTab('preferences')}
        >
          Roles & Locations
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'qa'}
          className={activeTab === 'qa' ? 'app-subtab active' : 'app-subtab'}
          onClick={() => setActiveTab('qa')}
        >
          Common Screening Q&A
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'auto-apply'}
          className={activeTab === 'auto-apply' ? 'app-subtab active auto-apply-tab' : 'app-subtab auto-apply-tab'}
          onClick={() => setActiveTab('auto-apply')}
        >
          <SlidersHorizontal size={14} /> Auto-Apply Preferences
        </button>
      </nav>

      {/* TAB 1: PROFESSIONAL INFO */}
      {activeTab === 'basic' && (
        <form className="app-profile-section-card" onSubmit={handleSaveProfile}>
          <div className="section-card-head">
            <div>
              <div className="section-kicker">SECTION 1 OF 5</div>
              <h2>Professional Background & Expertise</h2>
              <p className="section-card-desc">Your public headline, experience tier, and core technical skills.</p>
            </div>
          </div>

          <div className="app-form-grid">
            <div className="form-group form-group-full">
              <label htmlFor="pf-headline">Professional Headline <span className="req-star">*</span></label>
              <input
                id="pf-headline"
                value={form.headline}
                onChange={(e) => handleInputChange('headline', e.target.value)}
                placeholder="e.g. Senior Full-Stack Engineer | React, Node.js & PostgreSQL"
                maxLength="200"
              />
              <span className="field-help">A concise one-line summary displayed at the top of applications.</span>
            </div>

            <div className="form-group">
              <label htmlFor="pf-current-title">Current / Recent Job Title</label>
              <input
                id="pf-current-title"
                value={form.current_job_title}
                onChange={(e) => handleInputChange('current_job_title', e.target.value)}
                placeholder="e.g. Software Engineer"
                maxLength="120"
              />
            </div>

            <div className="form-group">
              <label htmlFor="pf-exp-level">Experience Level</label>
              <select
                id="pf-exp-level"
                value={form.experience_level}
                onChange={(e) => handleInputChange('experience_level', e.target.value)}
              >
                <option value="entry">Entry Level (0 - 2 years)</option>
                <option value="mid">Mid Level (3 - 5 years)</option>
                <option value="senior">Senior Level (5 - 8 years)</option>
                <option value="lead">Lead / Staff (8+ years)</option>
                <option value="executive">Director / Executive</option>
              </select>
            </div>

            <div className="form-group">
              <label htmlFor="pf-years-exp">Total Years of Experience</label>
              <input
                id="pf-years-exp"
                type="number"
                min="0"
                max="50"
                step="0.5"
                value={form.years_of_experience}
                onChange={(e) => handleInputChange('years_of_experience', e.target.value)}
                placeholder="e.g. 5"
              />
            </div>

            <div className="form-group form-group-full">
              <label htmlFor="pf-skills">Skills & Technologies (comma-separated)</label>
              <input
                id="pf-skills"
                value={form.skills}
                onChange={(e) => handleInputChange('skills', e.target.value)}
                placeholder="e.g. React, TypeScript, Node.js, PostgreSQL, Docker, AWS, GraphQL"
              />
              <span className="field-help">Separate skills with commas. Used for AI matching and automated screening.</span>
            </div>

            <div className="form-group form-group-full">
              <label htmlFor="pf-intro">Professional Summary & Bio</label>
              <textarea
                id="pf-intro"
                rows="4"
                value={form.professional_introduction}
                onChange={(e) => handleInputChange('professional_introduction', e.target.value)}
                placeholder="Describe your background, major achievements, core strengths, and what kind of roles excite you..."
              />
            </div>
          </div>

          {profileError && <p className="profile-form-error" role="alert">{profileError}</p>}
          {profileSuccess && <p className="profile-form-success" role="status">{profileSuccess}</p>}

          <div className="form-actions-bar">
            <button className="primary-button" type="submit" disabled={savingProfile || loading}>
              {savingProfile ? <><LoaderCircle className="spin" size={15} /> Saving…</> : <><Check size={15} /> Save Professional Info</>}
            </button>
          </div>
        </form>
      )}

      {/* TAB 2: AVAILABILITY & LOGISTICS */}
      {activeTab === 'logistics' && (
        <form className="app-profile-section-card" onSubmit={handleSaveProfile}>
          <div className="section-card-head">
            <div>
              <div className="section-kicker">SECTION 2 OF 5</div>
              <h2>Availability, Notice Period & Logistics</h2>
              <p className="section-card-desc">Specify when you can start, your notice period, and relocation terms.</p>
            </div>
          </div>

          <div className="app-form-grid">
            <div className="form-group">
              <label htmlFor="pf-joining-status">Joining Availability</label>
              <select
                id="pf-joining-status"
                value={form.joining_status}
                onChange={(e) => handleInputChange('joining_status', e.target.value)}
              >
                <option value="immediate">Immediately (Within 1 week)</option>
                <option value="15_days">15 Days Notice</option>
                <option value="30_days">30 Days Notice</option>
                <option value="60_days">60 Days Notice</option>
                <option value="90_days">90 Days Notice</option>
              </select>
            </div>

            <div className="form-group">
              <label htmlFor="pf-notice-days">Notice Period in Days</label>
              <input
                id="pf-notice-days"
                type="number"
                min="0"
                max="180"
                value={form.notice_period_days}
                onChange={(e) => handleInputChange('notice_period_days', e.target.value)}
                placeholder="e.g. 30"
              />
            </div>

            <div className="form-group">
              <label htmlFor="pf-available-from">Earliest Available Date</label>
              <input
                id="pf-available-from"
                type="date"
                value={form.available_from}
                onChange={(e) => handleInputChange('available_from', e.target.value)}
              />
            </div>

            <div className="form-group">
              <label htmlFor="pf-work-auth">Work Authorization Status</label>
              <input
                id="pf-work-auth"
                value={form.work_authorization}
                onChange={(e) => handleInputChange('work_authorization', e.target.value)}
                placeholder="e.g. Authorized to work in US / Citizen"
                maxLength="120"
              />
            </div>

            <div className="form-group">
              <label htmlFor="pf-shift">Shift Preference</label>
              <select
                id="pf-shift"
                value={form.shift_availability}
                onChange={(e) => handleInputChange('shift_availability', e.target.value)}
              >
                <option value="day">Standard Day Shift</option>
                <option value="flexible">Flexible / Any Shift</option>
                <option value="night">Night Shift</option>
                <option value="weekend">Weekend Support</option>
              </select>
            </div>

            <div className="form-group">
              <label htmlFor="pf-reloc-pref">Relocation Preference</label>
              <select
                id="pf-reloc-pref"
                value={form.relocation_preference}
                onChange={(e) => handleInputChange('relocation_preference', e.target.value)}
              >
                <option value="none">No Relocation (Remote or Local only)</option>
                <option value="domestic_only">Domestic Relocation Only</option>
                <option value="international_only">International Relocation</option>
                <option value="anywhere">Open to Relocate Anywhere</option>
              </select>
            </div>

            <div className="form-group form-group-full">
              <label className="checkbox-label-card">
                <input
                  type="checkbox"
                  checked={form.willing_to_relocate}
                  onChange={(e) => handleInputChange('willing_to_relocate', e.target.checked)}
                />
                <span className="checkbox-copy">
                  <strong>Willing to relocate for the right opportunity</strong>
                  <small>Check this if you are open to employer-sponsored or self-relocation.</small>
                </span>
              </label>
            </div>
          </div>

          {profileError && <p className="profile-form-error" role="alert">{profileError}</p>}
          {profileSuccess && <p className="profile-form-success" role="status">{profileSuccess}</p>}

          <div className="form-actions-bar">
            <button className="primary-button" type="submit" disabled={savingProfile || loading}>
              {savingProfile ? <><LoaderCircle className="spin" size={15} /> Saving…</> : <><Check size={15} /> Save Availability</>}
            </button>
          </div>
        </form>
      )}

      {/* TAB 3: SALARY & COMPENSATION */}
      {activeTab === 'salary' && (
        <form className="app-profile-section-card" onSubmit={handleSaveProfile}>
          <div className="section-card-head">
            <div>
              <div className="section-kicker">SECTION 3 OF 5</div>
              <h2>Salary Expectations & Compensation</h2>
              <p className="section-card-desc">Set your target compensation and minimum acceptable baseline.</p>
            </div>
          </div>

          <div className="app-form-grid">
            <div className="form-group">
              <label htmlFor="pf-exp-sal">Target / Expected Salary</label>
              <input
                id="pf-exp-sal"
                type="number"
                min="0"
                step="1000"
                value={form.expected_salary}
                onChange={(e) => handleInputChange('expected_salary', e.target.value)}
                placeholder="e.g. 135000"
              />
            </div>

            <div className="form-group">
              <label htmlFor="pf-min-sal">Minimum Acceptable Salary</label>
              <input
                id="pf-min-sal"
                type="number"
                min="0"
                step="1000"
                value={form.minimum_acceptable_salary}
                onChange={(e) => handleInputChange('minimum_acceptable_salary', e.target.value)}
                placeholder="e.g. 110000"
              />
              <span className="field-help">Jobs below this threshold will be flagged as lower match.</span>
            </div>

            <div className="form-group">
              <label htmlFor="pf-curr">Currency</label>
              <select
                id="pf-curr"
                value={form.salary_currency}
                onChange={(e) => handleInputChange('salary_currency', e.target.value)}
              >
                <option value="USD">USD ($ - US Dollar)</option>
                <option value="EUR">EUR (€ - Euro)</option>
                <option value="GBP">GBP (£ - British Pound)</option>
                <option value="CAD">CAD ($ - Canadian Dollar)</option>
                <option value="INR">INR (₹ - Indian Rupee)</option>
                <option value="AUD">AUD ($ - Australian Dollar)</option>
                <option value="SGD">SGD ($ - Singapore Dollar)</option>
                <option value="CHF">CHF (Swiss Franc)</option>
              </select>
            </div>

            <div className="form-group">
              <label htmlFor="pf-period">Salary Period</label>
              <select
                id="pf-period"
                value={form.salary_period}
                onChange={(e) => handleInputChange('salary_period', e.target.value)}
              >
                <option value="annual">Per Year (Annual)</option>
                <option value="monthly">Per Month</option>
                <option value="hourly">Per Hour</option>
              </select>
            </div>
          </div>

          {profileError && <p className="profile-form-error" role="alert">{profileError}</p>}
          {profileSuccess && <p className="profile-form-success" role="status">{profileSuccess}</p>}

          <div className="form-actions-bar">
            <button className="primary-button" type="submit" disabled={savingProfile || loading}>
              {savingProfile ? <><LoaderCircle className="spin" size={15} /> Saving…</> : <><Check size={15} /> Save Compensation</>}
            </button>
          </div>
        </form>
      )}

      {/* TAB 4: ROLES & LOCATIONS */}
      {activeTab === 'preferences' && (
        <form className="app-profile-section-card" onSubmit={handleSaveProfile}>
          <div className="section-card-head">
            <div>
              <div className="section-kicker">SECTION 4 OF 5</div>
              <h2>Target Roles, Locations & Preferences</h2>
              <p className="section-card-desc">Guide job recommendations and auto-apply target filters.</p>
            </div>
          </div>

          <div className="app-form-grid">
            <div className="form-group form-group-full">
              <label htmlFor="pf-roles">Target Job Titles (comma-separated)</label>
              <input
                id="pf-roles"
                value={form.preferred_roles}
                onChange={(e) => handleInputChange('preferred_roles', e.target.value)}
                placeholder="e.g. Senior Frontend Engineer, Full Stack Developer, React Specialist"
              />
            </div>

            <div className="form-group form-group-full">
              <label htmlFor="pf-locs">Preferred Cities / Locations (comma-separated)</label>
              <input
                id="pf-locs"
                value={form.preferred_locations}
                onChange={(e) => handleInputChange('preferred_locations', e.target.value)}
                placeholder="e.g. San Francisco, CA, New York, NY, Austin, TX, London"
              />
            </div>

            <div className="form-group">
              <label htmlFor="pf-remote-pref">Work Mode Preference</label>
              <select
                id="pf-remote-pref"
                value={form.remote_preference}
                onChange={(e) => handleInputChange('remote_preference', e.target.value)}
              >
                <option value="any">Any Work Mode (Remote, Hybrid, Onsite)</option>
                <option value="remote">Remote Only</option>
                <option value="hybrid">Hybrid</option>
                <option value="onsite">Onsite Only</option>
              </select>
            </div>

            <div className="form-group">
              <label htmlFor="pf-industries">Target Industries (comma-separated)</label>
              <input
                id="pf-industries"
                value={form.preferred_industries}
                onChange={(e) => handleInputChange('preferred_industries', e.target.value)}
                placeholder="e.g. SaaS, FinTech, AI, HealthTech, E-Commerce"
              />
            </div>

            <div className="form-group form-group-full">
              <label>Employment Types Desired</label>
              <div className="checkboxes-row">
                {[
                  { id: 'full-time', label: 'Full-time' },
                  { id: 'contract', label: 'Contract / Freelance' },
                  { id: 'part-time', label: 'Part-time' },
                  { id: 'internship', label: 'Internship' },
                ].map((type) => (
                  <label key={type.id} className="checkbox-item-pill">
                    <input
                      type="checkbox"
                      checked={form.employment_types.includes(type.id)}
                      onChange={() => handleCheckboxArrayToggle('employment_types', type.id)}
                    />
                    <span>{type.label}</span>
                  </label>
                ))}
              </div>
            </div>
          </div>

          {profileError && <p className="profile-form-error" role="alert">{profileError}</p>}
          {profileSuccess && <p className="profile-form-success" role="status">{profileSuccess}</p>}

          <div className="form-actions-bar">
            <button className="primary-button" type="submit" disabled={savingProfile || loading}>
              {savingProfile ? <><LoaderCircle className="spin" size={15} /> Saving…</> : <><Check size={15} /> Save Role Preferences</>}
            </button>
          </div>
        </form>
      )}

      {/* TAB 5: COMMON SCREENING Q&A */}
      {activeTab === 'qa' && (
        <form className="app-profile-section-card" onSubmit={handleSaveProfile}>
          <div className="section-card-head">
            <div>
              <div className="section-kicker">SECTION 5 OF 5</div>
              <h2>Common Screening Questions & Reusable Answers</h2>
              <p className="section-card-desc">
                Save pre-formulated responses for recurring application prompts (e.g. work authorization, portfolio links, motivation).
              </p>
            </div>
          </div>

          <div className="qa-section-body">
            {form.custom_answers.length > 0 ? (
              <div className="qa-list">
                {form.custom_answers.map((item, index) => (
                  <div key={index} className="qa-card-item">
                    <div className="qa-card-content">
                      <strong className="qa-question-text">{item.question}</strong>
                      <p className="qa-answer-text">{item.answer}</p>
                    </div>
                    <button
                      type="button"
                      className="qa-delete-btn"
                      onClick={() => handleRemoveCustomQA(index)}
                      title="Remove answer"
                      aria-label="Remove answer"
                    >
                      <Trash2 size={15} />
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <div className="empty-qa-box">
                <CircleHelp size={20} />
                <p>No screening questions saved yet. Add common prompts below to speed up your application filings.</p>
              </div>
            )}

            <div className="add-qa-panel">
              <h4>Add Screening Question & Answer</h4>
              <div className="add-qa-inputs">
                <input
                  value={newQuestion}
                  onChange={(e) => setNewQuestion(e.target.value)}
                  placeholder="e.g. Why are you interested in working with our team?"
                  maxLength="250"
                />
                <textarea
                  rows="3"
                  value={newAnswer}
                  onChange={(e) => setNewAnswer(e.target.value)}
                  placeholder="Enter your standard response..."
                  maxLength="2000"
                />
                <button
                  type="button"
                  className="secondary-button"
                  onClick={handleAddCustomQA}
                  disabled={!newQuestion.trim() || !newAnswer.trim()}
                >
                  <Plus size={15} /> Add to Saved Answers
                </button>
              </div>
            </div>
          </div>

          {profileError && <p className="profile-form-error" role="alert">{profileError}</p>}
          {profileSuccess && <p className="profile-form-success" role="status">{profileSuccess}</p>}

          <div className="form-actions-bar">
            <button className="primary-button" type="submit" disabled={savingProfile || loading}>
              {savingProfile ? <><LoaderCircle className="spin" size={15} /> Saving…</> : <><Check size={15} /> Save All Q&A Answers</>}
            </button>
          </div>
        </form>
      )}

      {/* TAB 6: AUTO-APPLY PREFERENCES & ENGINE CONTROLS */}
      {activeTab === 'auto-apply' && (
        <form className="app-profile-section-card auto-apply-card" onSubmit={handleSaveAutoApply}>
          <div className="auto-apply-hero-banner">
            <div className="auto-apply-hero-icon">
              <SlidersHorizontal size={24} />
            </div>
            <div>
              <div className="auto-apply-pill">SYSTEM STATUS: {autoApply.enabled ? 'ACTIVE' : 'OFF (DEFAULT)'}</div>
              <h3>Automated Application Submission Controls</h3>
              <p>
                Auto-Apply automatically matches verified open roles against your profile requirements. By default, Auto-Apply is disabled so you retain full manual control.
              </p>
            </div>
          </div>

          <div className="auto-apply-metrics-dashboard">
            <div className="metrics-header-label">LIVE QUEUE & APPLICATION STATUS</div>
            <div className="auto-apply-metrics-grid">
              <div className="auto-apply-metric-card">
                <span className="metric-number">{queueSummary.applied || 0}</span>
                <span className="metric-label">Auto-Applied</span>
              </div>
              <div className="auto-apply-metric-card">
                <span className="metric-number">{queueSummary.queued || 0}</span>
                <span className="metric-label">In Queue</span>
              </div>
              <div className="auto-apply-metric-card">
                <span className="metric-number">{queueSummary.processing || 0}</span>
                <span className="metric-label">Processing</span>
              </div>
              <div className="auto-apply-metric-card">
                <span className="metric-number">{queueSummary.blocked || 0}</span>
                <span className="metric-label">Blocked / Ineligible</span>
              </div>
            </div>
            <div className="auto-apply-readiness-row">
              <span className="readiness-label">Candidate Readiness:</span>
              <span className={`readiness-pill ${completeness.is_complete ? 'ready' : 'attention'}`}>
                {completeness.is_complete ? '✓ Ready for Auto-Apply' : '⚠ Action Required (Profile <80% or No Resume)'}
              </span>
            </div>
          </div>

          <div className="auto-apply-toggle-box">
            <label className="auto-apply-toggle-label">
              <input
                type="checkbox"
                checked={autoApply.enabled}
                onChange={(e) => setAutoApply((prev) => ({ ...prev, enabled: e.target.checked }))}
              />
              <span className="toggle-switch-visual" />
              <div className="toggle-text-block">
                <strong>Enable Automated Submissions</strong>
                <small>
                  When enabled, qualified internal roles meeting your match threshold and safety criteria can be processed.
                </small>
              </div>
            </label>
          </div>

          <div className="auto-apply-settings-grid">
            <div className="form-group form-group-full">
              <div className="slider-header-row">
                <label htmlFor="aa-score-slider">
                  Minimum Match Threshold: <strong>{autoApply.minimum_match_percentage}%</strong>
                </label>
                <span className="slider-score-indicator">{autoApply.minimum_match_percentage}% Score Required</span>
              </div>
              <input
                id="aa-score-slider"
                type="range"
                min="60"
                max="98"
                step="1"
                className="match-threshold-slider"
                value={autoApply.minimum_match_percentage}
                onChange={(e) => setAutoApply((prev) => ({ ...prev, minimum_match_percentage: Number(e.target.value) }))}
              />
              <span className="field-help">
                Jobs with a match score lower than {autoApply.minimum_match_percentage}% will never be submitted automatically.
              </span>
            </div>

            <div className="form-group form-group-full">
              <label>Allowed Work Modes for Auto-Apply</label>
              <div className="checkboxes-row">
                {[
                  { id: 'remote', label: 'Remote Roles' },
                  { id: 'hybrid', label: 'Hybrid Roles' },
                  { id: 'onsite', label: 'Onsite Roles' },
                ].map((mode) => (
                  <label key={mode.id} className="checkbox-item-pill">
                    <input
                      type="checkbox"
                      checked={autoApply.allowed_work_modes.includes(mode.id)}
                      onChange={() => handleAutoApplyArrayToggle('allowed_work_modes', mode.id)}
                    />
                    <span>{mode.label}</span>
                  </label>
                ))}
              </div>
            </div>

            <div className="form-group form-group-full">
              <label>Allowed Employment Types for Auto-Apply</label>
              <div className="checkboxes-row">
                {[
                  { id: 'full-time', label: 'Full-time' },
                  { id: 'contract', label: 'Contract' },
                  { id: 'part-time', label: 'Part-time' },
                ].map((type) => (
                  <label key={type.id} className="checkbox-item-pill">
                    <input
                      type="checkbox"
                      checked={autoApply.allowed_employment_types.includes(type.id)}
                      onChange={() => handleAutoApplyArrayToggle('allowed_employment_types', type.id)}
                    />
                    <span>{type.label}</span>
                  </label>
                ))}
              </div>
            </div>

            <div className="form-group form-group-full">
              <label>Safety & Quality Gates</label>
              <div className="safety-gates-list">
                <label className="checkbox-label-card">
                  <input
                    type="checkbox"
                    checked={autoApply.require_resume}
                    onChange={(e) => setAutoApply((prev) => ({ ...prev, require_resume: e.target.checked }))}
                  />
                  <span className="checkbox-copy">
                    <strong>Require Primary Resume Uploaded</strong>
                    <small>Prevent submissions if no active resume is configured.</small>
                  </span>
                </label>

                <label className="checkbox-label-card">
                  <input
                    type="checkbox"
                    checked={autoApply.require_complete_profile}
                    onChange={(e) => setAutoApply((prev) => ({ ...prev, require_complete_profile: e.target.checked }))}
                  />
                  <span className="checkbox-copy">
                    <strong>Require Complete Application Profile</strong>
                    <small>Ensure all essential profile criteria (headline, skills, salary, availability) are filled.</small>
                  </span>
                </label>
              </div>
            </div>

            <div className="form-group form-group-full auto-apply-eval-box">
              <div className="eval-header-row">
                <div>
                  <strong>Live Internal Match Evaluation</strong>
                  <p className="eval-subtext">Evaluate currently open internal recruiter jobs against your settings.</p>
                </div>
                <button
                  type="button"
                  className="secondary-button"
                  onClick={handleEvaluateJobs}
                  disabled={evaluatingQueue || loading}
                >
                  {evaluatingQueue ? <><LoaderCircle className="spin" size={14} /> Evaluating…</> : <><Sparkles size={14} /> Evaluate Open Roles</>}
                </button>
              </div>

              {evaluationResult && (
                <div className="eval-results-list">
                  <div className="eval-summary-banner">
                    Evaluated <strong>{evaluationResult.evaluated_count}</strong> jobs · <strong>{evaluationResult.eligible_count}</strong> meet Auto-Apply criteria
                  </div>
                  {evaluationResult.jobs?.slice(0, 5).map((ej) => (
                    <div key={ej.job.id} className="eval-item-card">
                      <div className="eval-item-main">
                        <strong>{ej.job.title}</strong>
                        <span className="eval-item-company">{ej.job.company} · {ej.job.location || ej.job.remote_type}</span>
                      </div>
                      <div className="eval-item-meta">
                        <span className="match-score-pill">{ej.match_score}% Match</span>
                        <span className={`eval-status-pill ${ej.eligible ? 'status-eligible' : 'status-ineligible'}`}>
                          {ej.eligible ? 'Eligible' : (ej.reasons?.[0] || 'Ineligible')}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {queueItems.length > 0 && (
              <div className="form-group form-group-full queue-history-box">
                <label>Recent Queue History</label>
                <div className="queue-history-list">
                  {queueItems.slice(0, 5).map((item) => (
                    <div key={item.id} className="queue-history-item">
                      <div>
                        <strong>{item.role || 'Job Listing'}</strong>
                        <span className="queue-company-sub">{item.company || 'Internal Employer'}</span>
                      </div>
                      <div className="queue-item-badges">
                        {item.match_score != null && <span className="match-score-pill">{item.match_score}%</span>}
                        <span className={`queue-badge queue-badge-${item.status}`}>{item.status.toUpperCase()}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="auto-apply-safety-notice">
              <ShieldCheck size={18} />
              <p>
                <strong>Strict Submission Scope:</strong> Auto-Apply operates exclusively on verified internal CareerStudio recruiter jobs where the application flow is fully managed. External listings (Adzuna, Arbeitnow, Jooble) always route candidates to the official website.
              </p>
            </div>
          </div>

          {autoApplyError && <p className="profile-form-error" role="alert">{autoApplyError}</p>}
          {autoApplySuccess && <p className="profile-form-success" role="status">{autoApplySuccess}</p>}

          <div className="form-actions-bar">
            <button className="primary-button" type="submit" disabled={savingAutoApply || loading}>
              {savingAutoApply ? <><LoaderCircle className="spin" size={15} /> Updating…</> : <><Check size={15} /> Save Auto-Apply Settings</>}
            </button>
          </div>
        </form>
      )}
    </section>
  )
}

function EmployerProfileSection({ user, onUserUpdated, onBack }) {
  const isJobSeeker = user?.role === 'job_seeker' || !user?.role
  const [activeTab, setActiveTab] = useState(isJobSeeker ? 'onboarding' : 'overview')
  const [loading, setLoading] = useState(!isJobSeeker)
  const [profile, setProfile] = useState(null)
  const [isEditingProfile, setIsEditingProfile] = useState(isJobSeeker)
  const [savingProfile, setSavingProfile] = useState(false)
  const [error, setError] = useState('')
  const [successMessage, setSuccessMessage] = useState('')
  const [profileFormErrors, setProfileFormErrors] = useState({})

  // Employer Profile Form State
  const [profileFormData, setProfileFormData] = useState({
    company_name: '',
    recruiter_name: user?.full_name || '',
    recruiter_email: user?.email || '',
    company_website: '',
    company_description: '',
    recruiter_phone: '',
  })

  // Employer Jobs List State
  const [myJobs, setMyJobs] = useState([])
  const [jobsLoading, setJobsLoading] = useState(false)
  const [jobActionBusy, setJobActionBusy] = useState(null)

  // Employer Dashboard & Analytics State (Step 9.5)
  const [dashboardData, setDashboardData] = useState(null)
  const [dashboardLoading, setDashboardLoading] = useState(false)

  // Employer Notifications State (Step 9.6)
  const [notifications, setNotifications] = useState([])
  const [unreadCount, setUnreadCount] = useState(0)
  const [notificationsOpen, setNotificationsOpen] = useState(false)
  const [notificationsLoading, setNotificationsLoading] = useState(false)
  const [notificationFilter, setNotificationFilter] = useState('all')
  const notifDropdownRef = useRef(null)

  // Applicants State (Step 9.4)
  const [applicants, setApplicants] = useState([])
  const [applicantsLoading, setApplicantsLoading] = useState(false)
  const [applicantJobFilter, setApplicantJobFilter] = useState('All')
  const [applicantStatusFilter, setApplicantStatusFilter] = useState('All')
  const [applicantSearch, setApplicantSearch] = useState('')
  const [selectedApplicant, setSelectedApplicant] = useState(null)
  const [updatingApplicantStatus, setUpdatingApplicantStatus] = useState(false)
  const [applicantModalFeedback, setApplicantModalFeedback] = useState({ error: '', success: '' })

  // Post Job Form State
  const [postJobForm, setPostJobForm] = useState({
    title: '',
    company: '',
    location: '',
    remote_type: 'remote',
    employment_type: 'full-time',
    industry: '',
    description: '',
    salary_min: '',
    salary_max: '',
    currency: 'USD',
    source_url: '',
  })
  const [postJobErrors, setPostJobErrors] = useState({})
  const [postingJob, setPostingJob] = useState(false)

  // Edit Job Modal State
  const [editingJob, setEditingJob] = useState(null)
  const [editJobForm, setEditJobForm] = useState(null)
  const [editJobErrors, setEditJobErrors] = useState({})
  const [savingEditJob, setSavingEditJob] = useState(false)

  // Close notifications dropdown on outside click
  useEffect(() => {
    function handleClickOutside(event) {
      if (notifDropdownRef.current && !notifDropdownRef.current.contains(event.target)) {
        setNotificationsOpen(false)
      }
    }
    if (notificationsOpen) {
      document.addEventListener('mousedown', handleClickOutside)
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [notificationsOpen])

  async function loadNotifications(filter = notificationFilter) {
    if (isJobSeeker) return
    setNotificationsLoading(true)
    try {
      const url = filter === 'unread' ? '/api/employer/notifications?filter=unread' : '/api/employer/notifications'
      const res = await fetch(url, { credentials: 'include' })
      const data = await readApiResponse(res)
      if (res.ok && data.ok) {
        setNotifications(data.notifications || [])
        setUnreadCount(data.unread_count || 0)
      }
    } catch {
      // ignore
    } finally {
      setNotificationsLoading(false)
    }
  }

  async function handleMarkSingleRead(notifId) {
    try {
      const res = await fetch(`/api/employer/notifications/${notifId}/read`, {
        method: 'PATCH',
        credentials: 'include',
      })
      if (res.ok) {
        setNotifications((prev) =>
          prev.map((n) => (n.id === notifId ? { ...n, is_read: true } : n)),
        )
        setUnreadCount((prev) => Math.max(0, prev - 1))
      }
    } catch {
      // ignore
    }
  }

  async function handleMarkAllNotificationsRead() {
    try {
      const res = await fetch('/api/employer/notifications/read-all', {
        method: 'POST',
        credentials: 'include',
      })
      if (res.ok) {
        setNotifications((prev) => prev.map((n) => ({ ...n, is_read: true })))
        setUnreadCount(0)
      }
    } catch {
      // ignore
    }
  }

  async function handleNotificationClick(n) {
    if (!n.is_read) {
      handleMarkSingleRead(n.id)
    }
    setNotificationsOpen(false)

    if (n.related_application_id) {
      setActiveTab('applicants')
      if (n.related_job_id) {
        setApplicantJobFilter(n.related_job_id)
      }
      loadApplicants()
    } else if (n.related_job_id) {
      setActiveTab('my-jobs')
    }
  }

  // Load Employer Data (Profile, Jobs, Applicants, Dashboard Analytics, Notifications)
  async function loadApplicants() {
    setApplicantsLoading(true)
    try {
      const res = await fetch('/api/employer/applicants', { credentials: 'include' })
      const data = await readApiResponse(res)
      if (res.ok && Array.isArray(data.applicants)) {
        setApplicants(data.applicants)
      }
    } catch {
      // ignore
    } finally {
      setApplicantsLoading(false)
    }
  }

  async function loadEmployerData() {
    if (isJobSeeker) return
    try {
      setJobsLoading(true)
      setApplicantsLoading(true)
      setDashboardLoading(true)
      const [profileRes, jobsRes, applicantsRes, dashboardRes, notifRes] = await Promise.all([
        fetch('/api/employer/profile', { credentials: 'include' }),
        fetch('/api/employer/jobs', { credentials: 'include' }),
        fetch('/api/employer/applicants', { credentials: 'include' }),
        fetch('/api/employer/dashboard', { credentials: 'include' }),
        fetch('/api/employer/notifications', { credentials: 'include' }),
      ])

      if (profileRes.ok) {
        const profileData = await readApiResponse(profileRes)
        if (profileData.profile) {
          setProfile(profileData.profile)
          setProfileFormData({
            company_name: profileData.profile.company_name || '',
            recruiter_name: profileData.profile.recruiter_name || user?.full_name || '',
            recruiter_email: profileData.profile.recruiter_email || user?.email || '',
            company_website: profileData.profile.company_website || '',
            company_description: profileData.profile.company_description || '',
            recruiter_phone: profileData.profile.recruiter_phone || '',
          })
          setPostJobForm((prev) => ({
            ...prev,
            company: prev.company || profileData.profile.company_name || '',
          }))
        }
      }

      if (jobsRes.ok) {
        const jobsData = await readApiResponse(jobsRes)
        if (Array.isArray(jobsData.jobs)) {
          setMyJobs(jobsData.jobs)
        }
      }

      if (applicantsRes.ok) {
        const applicantsData = await readApiResponse(applicantsRes)
        if (Array.isArray(applicantsData.applicants)) {
          setApplicants(applicantsData.applicants)
        }
      }

      if (dashboardRes.ok) {
        const dData = await readApiResponse(dashboardRes)
        if (dData.ok) {
          setDashboardData(dData)
        }
      }

      if (notifRes.ok) {
        const nData = await readApiResponse(notifRes)
        if (nData.ok) {
          setNotifications(nData.notifications || [])
          setUnreadCount(nData.unread_count || 0)
        }
      }
    } catch (err) {
      setError(err.message || 'Could not load employer data.')
    } finally {
      setLoading(false)
      setJobsLoading(false)
      setApplicantsLoading(false)
      setDashboardLoading(false)
    }
  }

  useEffect(() => {
    if (isJobSeeker) return undefined
    loadEmployerData()
  }, [user, isJobSeeker])

  async function handleUpdateApplicantStatus(applicationId, newStatus) {
    setUpdatingApplicantStatus(true)
    setApplicantModalFeedback({ error: '', success: '' })
    try {
      const response = await fetch(`/api/employer/applicants/${applicationId}`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus }),
      })
      const result = await readApiResponse(response)
      if (!response.ok) throw new Error(result.error || 'Could not update applicant status.')

      setApplicants((prev) =>
        prev.map((a) => (a.id === applicationId ? { ...a, status: newStatus } : a)),
      )
      if (selectedApplicant && selectedApplicant.id === applicationId) {
        setSelectedApplicant((prev) => ({ ...prev, status: newStatus }))
      }
      setApplicantModalFeedback({ error: '', success: `Applicant status updated to ${newStatus}.` })
      loadEmployerData()
    } catch (err) {
      setApplicantModalFeedback({ error: err.message || 'Could not update applicant status.', success: '' })
    } finally {
      setUpdatingApplicantStatus(false)
    }
  }

  // Profile Form Change Handlers
  function handleProfileInputChange(field, value) {
    setProfileFormData((prev) => ({ ...prev, [field]: value }))
    if (profileFormErrors[field]) {
      setProfileFormErrors((prev) => ({ ...prev, [field]: '' }))
    }
  }

  function validateProfile() {
    const errors = {}
    if (!profileFormData.company_name.trim()) errors.company_name = 'Company name is required.'
    if (!profileFormData.recruiter_name.trim()) errors.recruiter_name = 'Recruiter name is required.'
    const email = profileFormData.recruiter_email.trim()
    if (!email) errors.recruiter_email = 'Recruiter email is required.'
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errors.recruiter_email = 'Please provide a valid email address.'
    return errors
  }

  async function handleProfileSubmit(event) {
    event.preventDefault()
    const errors = validateProfile()
    if (Object.keys(errors).length > 0) {
      setProfileFormErrors(errors)
      return
    }

    setSavingProfile(true)
    setError('')
    setSuccessMessage('')

    const payload = {
      company_name: profileFormData.company_name.trim(),
      recruiter_name: profileFormData.recruiter_name.trim(),
      recruiter_email: profileFormData.recruiter_email.trim(),
      company_website: profileFormData.company_website.trim() || null,
      company_description: profileFormData.company_description.trim() || null,
      recruiter_phone: profileFormData.recruiter_phone.trim() || null,
    }

    try {
      if (isJobSeeker) {
        const response = await fetch('/api/employer/onboard', {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        })
        const result = await readApiResponse(response)
        if (!response.ok) throw new Error(result.error || 'Could not create employer profile.')

        if (result.user) onUserUpdated(result.user)
        setProfile(result.profile)
        setIsEditingProfile(false)
        setActiveTab('my-jobs')
        setPostJobForm((prev) => ({ ...prev, company: result.profile.company_name || '' }))
        setSuccessMessage('Recruiter profile created successfully! You can now post and manage jobs.')
      } else {
        const response = await fetch('/api/employer/profile', {
          method: 'PATCH',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        })
        const result = await readApiResponse(response)
        if (!response.ok) throw new Error(result.error || 'Could not update recruiter profile.')

        setProfile(result.profile)
        setIsEditingProfile(false)
        setSuccessMessage('Recruiter profile updated successfully.')
      }
    } catch (err) {
      setError(err.message || 'An error occurred while saving profile.')
    } finally {
      setSavingProfile(false)
    }
  }

  // Post Job Handlers
  function handlePostJobChange(field, value) {
    setPostJobForm((prev) => ({ ...prev, [field]: value }))
    if (postJobErrors[field]) {
      setPostJobErrors((prev) => ({ ...prev, [field]: '' }))
    }
  }

  function validatePostJob(data) {
    const errors = {}
    if (!data.title?.trim()) errors.title = 'Job title is required.'
    if (!data.company?.trim()) errors.company = 'Company name is required.'
    if (!data.location?.trim()) errors.location = 'Job location is required.'
    if (!data.remote_type?.trim()) errors.remote_type = 'Work mode is required.'
    if (!data.employment_type?.trim()) errors.employment_type = 'Employment type is required.'
    if (!data.description?.trim()) errors.description = 'Job description is required.'

    if (data.salary_min !== '' && data.salary_min !== null && data.salary_min !== undefined) {
      const minNum = Number(data.salary_min)
      if (!Number.isFinite(minNum) || minNum < 0) errors.salary_min = 'Min salary must be a positive number.'
    }
    if (data.salary_max !== '' && data.salary_max !== null && data.salary_max !== undefined) {
      const maxNum = Number(data.salary_max)
      if (!Number.isFinite(maxNum) || maxNum < 0) errors.salary_max = 'Max salary must be a positive number.'
    }
    if (
      data.salary_min !== '' && data.salary_min !== null &&
      data.salary_max !== '' && data.salary_max !== null &&
      Number(data.salary_min) > Number(data.salary_max)
    ) {
      errors.salary_max = 'Maximum salary cannot be less than minimum salary.'
    }

    return errors
  }

  async function handleCreateJobSubmit(event) {
    event.preventDefault()
    const errors = validatePostJob(postJobForm)
    if (Object.keys(errors).length > 0) {
      setPostJobErrors(errors)
      return
    }

    setPostingJob(true)
    setError('')
    setSuccessMessage('')

    const payload = {
      title: postJobForm.title.trim(),
      company: postJobForm.company.trim(),
      location: postJobForm.location.trim(),
      remote_type: postJobForm.remote_type.toLowerCase(),
      employment_type: postJobForm.employment_type.trim(),
      industry: postJobForm.industry.trim() || undefined,
      description: postJobForm.description.trim(),
      salary_min: postJobForm.salary_min !== '' ? Number(postJobForm.salary_min) : undefined,
      salary_max: postJobForm.salary_max !== '' ? Number(postJobForm.salary_max) : undefined,
      currency: (postJobForm.currency || 'USD').trim().toUpperCase(),
      source_url: postJobForm.source_url.trim() || undefined,
      status: 'open',
    }

    try {
      const response = await fetch('/api/jobs', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const result = await readApiResponse(response)
      if (!response.ok) throw new Error(result.error || 'Could not post job.')

      setMyJobs((prev) => [result, ...prev])
      setSuccessMessage(`Job "${result.title}" posted successfully! It is now live in open job discovery.`)
      setPostJobForm({
        title: '',
        company: profile?.company_name || '',
        location: '',
        remote_type: 'remote',
        employment_type: 'full-time',
        industry: '',
        description: '',
        salary_min: '',
        salary_max: '',
        currency: 'USD',
        source_url: '',
      })
      setActiveTab('my-jobs')
      loadEmployerData()
    } catch (err) {
      setError(err.message || 'Failed to post job.')
    } finally {
      setPostingJob(false)
    }
  }

  // Close Job Handler
  async function handleCloseJob(jobId) {
    setJobActionBusy(jobId)
    setError('')
    setSuccessMessage('')
    try {
      const response = await fetch(`/api/jobs/${jobId}/close`, {
        method: 'POST',
        credentials: 'include',
      })
      const result = await readApiResponse(response)
      if (!response.ok) throw new Error(result.error || 'Could not close job.')

      setMyJobs((prev) => prev.map((j) => (j.id === jobId ? result : j)))
      setSuccessMessage(`Job "${result.title}" closed successfully. It is now hidden from open discovery.`)
      loadEmployerData()
    } catch (err) {
      setError(err.message || 'Could not close job.')
    } finally {
      setJobActionBusy(null)
    }
  }

  // Reopen Job Handler
  async function handleReopenJob(jobId) {
    setJobActionBusy(jobId)
    setError('')
    setSuccessMessage('')
    try {
      const response = await fetch(`/api/jobs/${jobId}/reopen`, {
        method: 'POST',
        credentials: 'include',
      })
      const result = await readApiResponse(response)
      if (!response.ok) throw new Error(result.error || 'Could not reopen job.')

      setMyJobs((prev) => prev.map((j) => (j.id === jobId ? result : j)))
      setSuccessMessage(`Job "${result.title}" reopened successfully! It is now active again.`)
      loadEmployerData()
    } catch (err) {
      setError(err.message || 'Could not reopen job.')
    } finally {
      setJobActionBusy(null)
    }
  }

  // Edit Job Modal Handlers
  function openEditJobModal(job) {
    setEditingJob(job)
    setEditJobForm({
      title: job.title || '',
      company: job.company || '',
      location: job.location || '',
      remote_type: job.remote_type || 'remote',
      employment_type: job.employment_type || 'full-time',
      industry: job.industry || '',
      description: job.description || '',
      salary_min: job.salary_min != null ? String(job.salary_min) : '',
      salary_max: job.salary_max != null ? String(job.salary_max) : '',
      currency: job.currency || 'USD',
      source_url: job.source_url || '',
    })
    setEditJobErrors({})
  }

  async function handleSaveEditedJob(event) {
    event.preventDefault()
    if (!editingJob || !editJobForm) return
    const errors = validatePostJob(editJobForm)
    if (Object.keys(errors).length > 0) {
      setEditJobErrors(errors)
      return
    }

    setSavingEditJob(true)
    setError('')
    setSuccessMessage('')

    const payload = {
      title: editJobForm.title.trim(),
      company: editJobForm.company.trim(),
      location: editJobForm.location.trim(),
      remote_type: editJobForm.remote_type.toLowerCase(),
      employment_type: editJobForm.employment_type.trim(),
      industry: editJobForm.industry.trim() || undefined,
      description: editJobForm.description.trim(),
      salary_min: editJobForm.salary_min !== '' ? Number(editJobForm.salary_min) : null,
      salary_max: editJobForm.salary_max !== '' ? Number(editJobForm.salary_max) : null,
      currency: (editJobForm.currency || 'USD').trim().toUpperCase(),
      source_url: editJobForm.source_url.trim() || '',
    }

    try {
      const response = await fetch(`/api/jobs/${editingJob.id}`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const result = await readApiResponse(response)
      if (!response.ok) throw new Error(result.error || 'Could not update job.')

      setMyJobs((prev) => prev.map((j) => (j.id === editingJob.id ? result : j)))
      setSuccessMessage(`Job "${result.title}" updated successfully.`)
      setEditingJob(null)
      setEditJobForm(null)
      loadEmployerData()
    } catch (err) {
      setEditJobErrors((prev) => ({ ...prev, form: err.message || 'Could not save job changes.' }))
    } finally {
      setSavingEditJob(false)
    }
  }

  const openCount = myJobs.filter((j) => j.status === 'open').length
  const closedCount = myJobs.filter((j) => j.status === 'closed').length

  const filteredApplicants = applicants.filter((applicant) => {
    if (applicantJobFilter !== 'All' && applicant.job_id !== applicantJobFilter) {
      return false
    }
    if (applicantStatusFilter !== 'All' && applicant.status?.toLowerCase() !== applicantStatusFilter.toLowerCase()) {
      return false
    }
    if (applicantSearch.trim()) {
      const q = applicantSearch.trim().toLowerCase()
      const name = (applicant.applicant_name || '').toLowerCase()
      const email = (applicant.applicant_email || '').toLowerCase()
      const title = (applicant.job_title || '').toLowerCase()
      const company = (applicant.job_company || '').toLowerCase()
      if (!name.includes(q) && !email.includes(q) && !title.includes(q) && !company.includes(q)) {
        return false
      }
    }
    return true
  })

  const stageCounts = {
    All: applicants.length,
    Applied: applicants.filter((a) => a.status === 'Applied').length,
    Interview: applicants.filter((a) => a.status === 'Interview').length,
    Offer: applicants.filter((a) => a.status === 'Offer').length,
    Rejected: applicants.filter((a) => a.status === 'Rejected').length,
    Saved: applicants.filter((a) => a.status === 'Saved').length,
  }

  return (
    <section className="profile-view employer-profile-view" aria-labelledby="employer-title">
      <header className="profile-page-heading">
        <div>
          <div className="section-kicker">RECRUITER WORKSPACE</div>
          <h1 id="employer-title">{isJobSeeker ? 'Recruiter Onboarding' : 'Recruiter Dashboard & Hiring'}</h1>
          <p className="welcome-subtitle">
            {isJobSeeker
              ? 'Set up your recruiter profile to post jobs and find top candidates.'
              : 'Monitor real-time hiring metrics, manage candidate pipelines, and track job performance.'}
          </p>
        </div>
        <div className="employer-header-actions">
          {!isJobSeeker && (
            <div className="employer-notif-dropdown-wrapper" ref={notifDropdownRef}>
              <button
                className={`employer-notif-bell-btn ${notificationsOpen ? 'active' : ''}`}
                type="button"
                aria-label="Employer notifications"
                aria-expanded={notificationsOpen}
                onClick={() => {
                  const nextState = !notificationsOpen
                  setNotificationsOpen(nextState)
                  if (nextState) loadNotifications(notificationFilter)
                }}
              >
                <Bell size={16} />
                {unreadCount > 0 && (
                  <span className="notif-badge">{unreadCount > 99 ? '99+' : unreadCount}</span>
                )}
              </button>

              {notificationsOpen && (
                <div className="employer-notif-panel" role="region" aria-label="Notifications panel">
                  <div className="notif-panel-header">
                    <div className="notif-panel-title">
                      <strong>Notifications</strong>
                      {unreadCount > 0 && <span className="notif-unread-tag">{unreadCount} unread</span>}
                    </div>
                    <div className="notif-header-actions">
                      {unreadCount > 0 && (
                        <button
                          className="notif-mark-all-btn"
                          type="button"
                          onClick={handleMarkAllNotificationsRead}
                        >
                          <Check size={13} /> Mark all read
                        </button>
                      )}
                    </div>
                  </div>

                  <div className="notif-filter-tabs">
                    <button
                      className={`notif-tab ${notificationFilter === 'all' ? 'active' : ''}`}
                      type="button"
                      onClick={() => {
                        setNotificationFilter('all')
                        loadNotifications('all')
                      }}
                    >
                      All
                    </button>
                    <button
                      className={`notif-tab ${notificationFilter === 'unread' ? 'active' : ''}`}
                      type="button"
                      onClick={() => {
                        setNotificationFilter('unread')
                        loadNotifications('unread')
                      }}
                    >
                      Unread {unreadCount > 0 ? `(${unreadCount})` : ''}
                    </button>
                  </div>

                  <div className="notif-items-list">
                    {notificationsLoading && (
                      <div className="notif-status-msg">
                        <LoaderCircle className="spin" size={15} /> Loading notifications...
                      </div>
                    )}

                    {!notificationsLoading && notifications.length === 0 && (
                      <div className="notif-empty-state">
                        <Bell size={20} className="notif-empty-icon" />
                        <strong>No new notifications.</strong>
                        <span>{notificationFilter === 'unread' ? 'You have caught up on all unread notifications.' : 'Activity related to your jobs and applicants will appear here.'}</span>
                      </div>
                    )}

                    {!notificationsLoading && notifications.map((n) => (
                      <div
                        key={n.id}
                        className={`notif-item ${n.is_read ? 'read' : 'unread'}`}
                        onClick={() => handleNotificationClick(n)}
                        role="button"
                        tabIndex={0}
                      >
                        <div className="notif-item-icon">
                          {n.type === 'new_application' ? <Users size={14} /> : <Sparkles size={14} />}
                        </div>
                        <div className="notif-item-content">
                          <div className="notif-item-title-row">
                            <span className="notif-item-title">{n.title}</span>
                            {!n.is_read && <span className="notif-unread-dot" title="Unread notification" />}
                          </div>
                          <p className="notif-item-msg">{n.message}</p>
                          <small className="notif-item-time">{formatRelativeTime(n.created_at)}</small>
                        </div>
                        {!n.is_read && (
                          <button
                            className="notif-mark-single-btn"
                            type="button"
                            title="Mark as read"
                            onClick={(e) => {
                              e.stopPropagation()
                              handleMarkSingleRead(n.id)
                            }}
                          >
                            <Check size={12} />
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          <button className="secondary-button profile-back" type="button" onClick={onBack}>
            <ArrowLeft size={15} /> Back to overview
          </button>
        </div>
      </header>

      {loading && (
        <div className="profile-loading" role="status">
          <LoaderCircle className="spin" size={17} /> Loading recruiter workspace
        </div>
      )}

      {error && (
        <div className="profile-alert" role="alert">
          <CircleHelp size={16} /> {error}
        </div>
      )}

      {successMessage && (
        <div className="profile-success-banner" role="status">
          <CheckCircle2 size={16} /> {successMessage}
        </div>
      )}

      {!loading && !isJobSeeker && (
        <div className="employer-tab-nav" role="tablist" aria-label="Employer sections">
          <button
            className={activeTab === 'overview' ? 'employer-tab-btn active' : 'employer-tab-btn'}
            type="button"
            role="tab"
            aria-selected={activeTab === 'overview'}
            onClick={() => { setActiveTab('overview'); setError(''); setSuccessMessage(''); loadEmployerData() }}
          >
            <LayoutDashboard size={15} />
            <span>Overview</span>
          </button>
          <button
            className={activeTab === 'my-jobs' ? 'employer-tab-btn active' : 'employer-tab-btn'}
            type="button"
            role="tab"
            aria-selected={activeTab === 'my-jobs'}
            onClick={() => { setActiveTab('my-jobs'); setError(''); setSuccessMessage('') }}
          >
            <BriefcaseBusiness size={15} />
            <span>My Jobs</span>
            <span className="tab-count-badge">{myJobs.length}</span>
          </button>
          <button
            className={activeTab === 'applicants' ? 'employer-tab-btn active' : 'employer-tab-btn'}
            type="button"
            role="tab"
            aria-selected={activeTab === 'applicants'}
            onClick={() => { setActiveTab('applicants'); setError(''); setSuccessMessage(''); loadApplicants() }}
          >
            <Users size={15} />
            <span>Applicants</span>
            <span className="tab-count-badge">{applicants.length}</span>
          </button>
          <button
            className={activeTab === 'post-job' ? 'employer-tab-btn active' : 'employer-tab-btn'}
            type="button"
            role="tab"
            aria-selected={activeTab === 'post-job'}
            onClick={() => { setActiveTab('post-job'); setError(''); setSuccessMessage('') }}
          >
            <Plus size={15} />
            <span>Post a Job</span>
          </button>
          <button
            className={activeTab === 'company-profile' ? 'employer-tab-btn active' : 'employer-tab-btn'}
            type="button"
            role="tab"
            aria-selected={activeTab === 'company-profile'}
            onClick={() => { setActiveTab('company-profile'); setError(''); setSuccessMessage('') }}
          >
            <Building2 size={15} />
            <span>Company Profile</span>
          </button>
        </div>
      )}

      {/* 1. OVERVIEW / DASHBOARD TAB (Step 9.5) */}
      {!loading && !isJobSeeker && activeTab === 'overview' && (
        <div className="employer-dashboard-content">
          {/* Summary Stat Cards Grid */}
          <div className="employer-dashboard-stats-grid">
            <div className="dash-stat-card">
              <div className="dash-stat-icon icon-jobs">
                <BriefcaseBusiness size={20} />
              </div>
              <div className="dash-stat-info">
                <span className="dash-stat-label">Total Jobs</span>
                <strong className="dash-stat-value">{dashboardData?.summary?.jobs?.total_jobs ?? myJobs.length}</strong>
                <span className="dash-stat-sub">{dashboardData?.summary?.jobs?.open_jobs ?? openCount} Active / Open</span>
              </div>
            </div>

            <div className="dash-stat-card">
              <div className="dash-stat-icon icon-open">
                <CheckCircle2 size={20} />
              </div>
              <div className="dash-stat-info">
                <span className="dash-stat-label">Open Positions</span>
                <strong className="dash-stat-value stat-open-color">{dashboardData?.summary?.jobs?.open_jobs ?? openCount}</strong>
                <span className="dash-stat-sub">{dashboardData?.summary?.jobs?.closed_jobs ?? closedCount} Closed</span>
              </div>
            </div>

            <div className="dash-stat-card">
              <div className="dash-stat-icon icon-candidates">
                <Users size={20} />
              </div>
              <div className="dash-stat-info">
                <span className="dash-stat-label">Total Applicants</span>
                <strong className="dash-stat-value">{dashboardData?.summary?.applications?.total_applications ?? applicants.length}</strong>
                <span className="dash-stat-sub">{dashboardData?.summary?.applications?.applied_applications ?? stageCounts.Applied} Under Review</span>
              </div>
            </div>

            <div className="dash-stat-card">
              <div className="dash-stat-icon icon-interviews">
                <Sparkles size={20} />
              </div>
              <div className="dash-stat-info">
                <span className="dash-stat-label">Interviews</span>
                <strong className="dash-stat-value stat-interview-color">{dashboardData?.summary?.applications?.interview_applications ?? stageCounts.Interview}</strong>
                <span className="dash-stat-sub">In Pipeline</span>
              </div>
            </div>

            <div className="dash-stat-card">
              <div className="dash-stat-icon icon-offers">
                <CheckCircle2 size={20} />
              </div>
              <div className="dash-stat-info">
                <span className="dash-stat-label">Offers Extended</span>
                <strong className="dash-stat-value stat-offer-color">{dashboardData?.summary?.applications?.offer_applications ?? stageCounts.Offer}</strong>
                <span className="dash-stat-sub">{dashboardData?.summary?.applications?.rejected_applications ?? stageCounts.Rejected} Declined/Archived</span>
              </div>
            </div>
          </div>

          {/* Quick Actions Bar */}
          <div className="employer-quick-actions-bar">
            <span className="quick-actions-title">Quick Actions:</span>
            <div className="quick-actions-buttons">
              <button
                className="primary-button small-button"
                type="button"
                onClick={() => { setActiveTab('post-job'); setError(''); setSuccessMessage('') }}
              >
                <Plus size={14} /> Post a Job
              </button>
              <button
                className="secondary-button small-button"
                type="button"
                onClick={() => { setActiveTab('applicants'); setError(''); setSuccessMessage(''); loadApplicants() }}
              >
                <Users size={14} /> View Applicants ({applicants.length})
              </button>
              <button
                className="secondary-button small-button"
                type="button"
                onClick={() => { setActiveTab('my-jobs'); setError(''); setSuccessMessage('') }}
              >
                <BriefcaseBusiness size={14} /> Manage Jobs ({myJobs.length})
              </button>
              <button
                className="secondary-button small-button"
                type="button"
                onClick={() => { setActiveTab('company-profile'); setError(''); setSuccessMessage('') }}
              >
                <Building2 size={14} /> Company Profile
              </button>
            </div>
          </div>

          {/* Two-Column Analytics Layout */}
          <div className="employer-dashboard-grid">
            {/* Left Column: Job Analytics Table */}
            <section className="dashboard-section" aria-labelledby="job-performance-heading">
              <div className="section-heading">
                <div>
                  <div className="section-kicker">JOB ANALYTICS</div>
                  <h2 id="job-performance-heading">Job Performance & Pipelines</h2>
                </div>
                <button
                  className="text-button"
                  type="button"
                  onClick={() => setActiveTab('my-jobs')}
                >
                  View all ({myJobs.length}) <ArrowUpRight size={13} />
                </button>
              </div>

              <div className="table-scroll">
                <table className="applications-table dashboard-table">
                  <thead>
                    <tr>
                      <th>ROLE & STATUS</th>
                      <th>APPLICANTS</th>
                      <th>INTERVIEWS</th>
                      <th>OFFERS</th>
                      <th>ACTIONS</th>
                    </tr>
                  </thead>
                  <tbody>
                    {dashboardLoading && (
                      <tr>
                        <td className="table-message" colSpan="5">
                          <LoaderCircle className="spin" size={15} /> Loading job analytics...
                        </td>
                      </tr>
                    )}
                    {!dashboardLoading && (dashboardData?.jobs_analytics?.length ? dashboardData.jobs_analytics : myJobs).map((job) => {
                      const jobStats = dashboardData?.jobs_analytics?.find((j) => j.id === job.id) || job
                      return (
                        <tr key={job.id}>
                          <td>
                            <div className="dash-job-cell">
                              <strong>{job.title}</strong>
                              <div className="dash-job-meta">
                                <span className={`job-posting-status-badge status-${job.status}`}>
                                  {job.status === 'open' ? 'Open' : 'Closed'}
                                </span>
                                <small>{job.location || 'Remote'}</small>
                              </div>
                            </div>
                          </td>
                          <td>
                            <strong className="dash-num-badge">{jobStats.applicant_count ?? 0}</strong>
                          </td>
                          <td>
                            <span className="dash-stat-pill pill-interview">{jobStats.interview_count ?? 0}</span>
                          </td>
                          <td>
                            <span className="dash-stat-pill pill-offer">{jobStats.offer_count ?? 0}</span>
                          </td>
                          <td>
                            <div className="dash-action-group">
                              <button
                                className="secondary-button mini-btn"
                                type="button"
                                title="View candidate applications for this role"
                                onClick={() => {
                                  setApplicantJobFilter(job.id)
                                  setActiveTab('applicants')
                                  loadApplicants()
                                }}
                              >
                                <Users size={12} /> Applicants
                              </button>
                              <button
                                className="secondary-button mini-btn"
                                type="button"
                                title="Edit job details"
                                onClick={() => openEditJobModal(job)}
                              >
                                <Pencil size={12} /> Edit
                              </button>
                            </div>
                          </td>
                        </tr>
                      )
                    })}
                    {!dashboardLoading && myJobs.length === 0 && (
                      <tr>
                        <td className="empty-cell" colSpan="5">
                          <div className="empty-state">
                            <span className="empty-icon"><BriefcaseBusiness size={18} /></span>
                            <strong>You haven't posted any jobs yet.</strong>
                            <span>Create a job listing to start receiving and reviewing qualified applicants.</span>
                            <button
                              className="primary-button small-button"
                              type="button"
                              onClick={() => setActiveTab('post-job')}
                            >
                              <Plus size={14} /> Post your first job
                            </button>
                          </div>
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </section>

            {/* Right Column: Recent Applications Activity */}
            <section className="dashboard-section" aria-labelledby="recent-apps-heading">
              <div className="section-heading">
                <div>
                  <div className="section-kicker">TALENT FEED</div>
                  <h2 id="recent-apps-heading">Recent Applications</h2>
                </div>
                <button
                  className="text-button"
                  type="button"
                  onClick={() => { setActiveTab('applicants'); loadApplicants() }}
                >
                  View all ({applicants.length}) <ArrowUpRight size={13} />
                </button>
              </div>

              <div className="dashboard-recent-apps-list">
                {dashboardLoading && (
                  <div className="table-message">
                    <LoaderCircle className="spin" size={15} /> Loading recent activity...
                  </div>
                )}
                {!dashboardLoading && (dashboardData?.recent_activity?.recent_applications?.length ? dashboardData.recent_activity.recent_applications : applicants.slice(0, 8)).map((app) => (
                  <div key={app.id} className="recent-app-item">
                    <div className="applicant-avatar-circle">
                      {getInitials(app.applicant_name || app.applicant_email)}
                    </div>
                    <div className="recent-app-details">
                      <div className="recent-app-title-row">
                        <strong>{app.applicant_name || 'Anonymous Candidate'}</strong>
                        <span className={`status-pill status-${(app.status || 'applied').toLowerCase()}`}>
                          {app.status}
                        </span>
                      </div>
                      <div className="recent-app-sub">
                        <span>{app.job_title}</span>
                        <span className="dash-dot">•</span>
                        <span>{app.applied_at ? formatDate(app.applied_at) : formatDate(app.created_at)}</span>
                      </div>
                    </div>
                    <button
                      className="secondary-button mini-btn"
                      type="button"
                      onClick={() => {
                        setSelectedApplicant(app)
                        setApplicantModalFeedback({ error: '', success: '' })
                      }}
                    >
                      <Eye size={12} /> Review
                    </button>
                  </div>
                ))}
                {!dashboardLoading && applicants.length === 0 && (!dashboardData?.recent_activity?.recent_applications || dashboardData.recent_activity.recent_applications.length === 0) && (
                  <div className="empty-state" style={{ padding: '24px 16px' }}>
                    <span className="empty-icon"><Users size={18} /></span>
                    <strong>No applications yet.</strong>
                    <span>Candidate applications will appear here in real time as job seekers apply.</span>
                  </div>
                )}
              </div>
            </section>
          </div>
        </div>
      )}

      {/* 2. MY JOBS TAB */}
      {!loading && !isJobSeeker && activeTab === 'my-jobs' && (
        <div className="employer-jobs-tab-content">
          <div className="employer-stats-bar">
            <div className="employer-mini-stat">
              <span>Total Postings</span>
              <strong>{myJobs.length}</strong>
            </div>
            <div className="employer-mini-stat">
              <span>Active / Open</span>
              <strong className="stat-open-color">{openCount}</strong>
            </div>
            <div className="employer-mini-stat">
              <span>Closed</span>
              <strong>{closedCount}</strong>
            </div>
            <div className="employer-stats-action">
              <button
                className="primary-button small-button"
                type="button"
                onClick={() => { setActiveTab('post-job'); setError(''); setSuccessMessage('') }}
              >
                <Plus size={15} /> Post New Job
              </button>
            </div>
          </div>

          <section className="pipeline-section" aria-labelledby="my-jobs-heading">
            <div className="section-heading">
              <div>
                <div className="section-kicker">POSTED ROLES</div>
                <h2 id="my-jobs-heading">Your Job Postings</h2>
              </div>
            </div>

            <div className="table-scroll">
              <table className="applications-table">
                <thead>
                  <tr>
                    <th>ROLE & COMPANY</th>
                    <th>LOCATION</th>
                    <th>WORK MODE</th>
                    <th>EMPLOYMENT</th>
                    <th>SALARY</th>
                    <th>STATUS</th>
                    <th>POSTED</th>
                    <th>ACTIONS</th>
                  </tr>
                </thead>
                <tbody>
                  {jobsLoading && (
                    <tr>
                      <td className="table-message" colSpan="8">Loading your job postings...</td>
                    </tr>
                  )}
                  {!jobsLoading && myJobs.map((job) => (
                    <tr key={job.id}>
                      <td>
                        <div className="job-role-cell">
                          <span className="job-company-icon"><Building2 size={14} /></span>
                          <div>
                            <strong>{job.title}</strong>
                            <small>{job.company}</small>
                          </div>
                        </div>
                      </td>
                      <td>{job.location || '—'}</td>
                      <td>
                        <span className={`work-mode-pill mode-${(job.remote_type || 'onsite').toLowerCase()}`}>
                          {formatWorkMode(job.remote_type)}
                        </span>
                      </td>
                      <td>{formatEmploymentType(job.employment_type)}</td>
                      <td>{formatSalary(job.salary_min, job.salary_max, job.currency) || 'Not listed'}</td>
                      <td>
                        <span className={`job-posting-status-badge status-${job.status}`}>
                          {job.status === 'open' ? <CheckCircle2 size={12} /> : <Clock3 size={12} />}
                          <span>{job.status === 'open' ? 'Open' : 'Closed'}</span>
                        </span>
                      </td>
                      <td className="date-cell">{job.posted_at ? formatDate(job.posted_at) : formatDate(job.created_at)}</td>
                      <td>
                        <div className="job-row-actions">
                          <button
                            className="secondary-button mini-btn"
                            type="button"
                            onClick={() => openEditJobModal(job)}
                            disabled={jobActionBusy === job.id}
                          >
                            <Pencil size={12} /> Edit
                          </button>
                          {job.status === 'open' ? (
                            <button
                              className="secondary-button mini-btn close-job-btn"
                              type="button"
                              onClick={() => handleCloseJob(job.id)}
                              disabled={jobActionBusy === job.id}
                            >
                              {jobActionBusy === job.id ? <LoaderCircle className="spin" size={12} /> : 'Close'}
                            </button>
                          ) : (
                            <button
                              className="primary-button mini-btn reopen-job-btn"
                              type="button"
                              onClick={() => handleReopenJob(job.id)}
                              disabled={jobActionBusy === job.id}
                            >
                              {jobActionBusy === job.id ? <LoaderCircle className="spin" size={12} /> : 'Reopen'}
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                  {!jobsLoading && myJobs.length === 0 && (
                    <tr>
                      <td className="empty-cell" colSpan="8">
                        <div className="empty-state">
                          <span className="empty-icon"><BriefcaseBusiness size={18} /></span>
                          <strong>You haven't posted any jobs yet</strong>
                          <span>Create a job listing to reach qualified candidates and begin tracking matches.</span>
                          <button
                            className="primary-button small-button"
                            type="button"
                            onClick={() => { setActiveTab('post-job'); setError(''); setSuccessMessage('') }}
                          >
                            <Plus size={15} /> Post your first job
                          </button>
                        </div>
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      )}

      {/* 3. APPLICANTS TAB */}
      {!loading && !isJobSeeker && activeTab === 'applicants' && (
        <div className="employer-jobs-tab-content">
          <div className="table-toolbar" style={{ padding: 0 }}>
            <div className="filter-tabs" role="tablist" aria-label="Filter applicants by stage">
              {['All', 'Applied', 'Interview', 'Offer', 'Rejected'].map((stage) => (
                <button
                  key={stage}
                  className={applicantStatusFilter === stage ? 'filter-tab active' : 'filter-tab'}
                  type="button"
                  role="tab"
                  aria-selected={applicantStatusFilter === stage}
                  onClick={() => setApplicantStatusFilter(stage)}
                >
                  {stage}
                  <span className="filter-count">{stageCounts[stage] ?? 0}</span>
                </button>
              ))}
            </div>

            <div className="discovery-filter-group" style={{ gap: '10px' }}>
              <label className="filter-select-label" htmlFor="applicant-job-filter">
                <span>Filter by Job:</span>
                <select
                  id="applicant-job-filter"
                  value={applicantJobFilter}
                  onChange={(e) => setApplicantJobFilter(e.target.value)}
                >
                  <option value="All">All Jobs ({myJobs.length})</option>
                  {myJobs.map((j) => (
                    <option key={j.id} value={j.id}>{j.title}</option>
                  ))}
                </select>
              </label>

              <div className="search-field" style={{ minWidth: '220px' }}>
                <Search size={15} />
                <input
                  type="search"
                  placeholder="Search candidates..."
                  value={applicantSearch}
                  onChange={(e) => setApplicantSearch(e.target.value)}
                  aria-label="Search candidates"
                />
              </div>
            </div>
          </div>

          <section className="pipeline-section" aria-labelledby="applicants-heading">
            <div className="section-heading">
              <div>
                <div className="section-kicker">CANDIDATE PIPELINE</div>
                <h2 id="applicants-heading">Applicant Management</h2>
              </div>
            </div>

            <div className="table-scroll">
              <table className="applications-table">
                <thead>
                  <tr>
                    <th>CANDIDATE</th>
                    <th>APPLIED FOR</th>
                    <th>STAGE</th>
                    <th>APPLIED DATE</th>
                    <th>RESUME</th>
                    <th>ACTIONS</th>
                  </tr>
                </thead>
                <tbody>
                  {applicantsLoading && (
                    <tr>
                      <td className="table-message" colSpan="6">Loading applicants...</td>
                    </tr>
                  )}
                  {!applicantsLoading && filteredApplicants.map((app) => (
                    <tr key={app.id}>
                      <td>
                        <div className="candidate-applicant-cell">
                          <div className="applicant-avatar-circle">
                            {getInitials(app.applicant_name || app.applicant_email)}
                          </div>
                          <div className="candidate-info">
                            <strong>{app.applicant_name || 'Anonymous Candidate'}</strong>
                            <small>{app.applicant_email}</small>
                          </div>
                        </div>
                      </td>
                      <td>
                        <div className="candidate-info">
                          <strong>{app.job_title}</strong>
                          <small>{app.job_location || 'Remote'}</small>
                        </div>
                      </td>
                      <td>
                        <select
                          className="applicant-status-select"
                          value={app.status}
                          disabled={updatingApplicantStatus}
                          onChange={(e) => handleUpdateApplicantStatus(app.id, e.target.value)}
                          aria-label={`Update status for ${app.applicant_name || 'candidate'}`}
                        >
                          <option value="Applied">Applied</option>
                          <option value="Interview">Interview</option>
                          <option value="Offer">Offer</option>
                          <option value="Rejected">Rejected</option>
                          <option value="Saved">Saved</option>
                        </select>
                      </td>
                      <td className="date-cell">{app.applied_at ? formatDate(app.applied_at) : formatDate(app.created_at)}</td>
                      <td>
                        {app.resume_filename ? (
                          <span className="candidate-resume-link" title={app.resume_filename}>
                            <FileText size={13} /> {app.resume_filename}
                          </span>
                        ) : (
                          <span className="text-muted" style={{ fontSize: '11px' }}>None</span>
                        )}
                      </td>
                      <td>
                        <button
                          className="secondary-button mini-btn"
                          type="button"
                          onClick={() => {
                            setSelectedApplicant(app)
                            setApplicantModalFeedback({ error: '', success: '' })
                          }}
                        >
                          <Eye size={12} /> Review
                        </button>
                      </td>
                    </tr>
                  ))}
                  {!applicantsLoading && filteredApplicants.length === 0 && (
                    <tr>
                      <td className="empty-cell" colSpan="6">
                        <div className="empty-state">
                          <span className="empty-icon"><Users size={18} /></span>
                          <strong>No candidate applications found</strong>
                          <span>
                            {applicants.length === 0
                              ? 'When job seekers apply for your open roles, they will appear in this pipeline.'
                              : 'Try changing your job or status filter criteria.'}
                          </span>
                        </div>
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      )}

      {/* 4. POST A JOB TAB */}
      {!loading && !isJobSeeker && activeTab === 'post-job' && (
        <section className="profile-details-section employer-form-section" aria-labelledby="post-job-heading">
          <div className="profile-section-heading">
            <div>
              <div className="section-kicker">NEW LISTING</div>
              <h2 id="post-job-heading">Post an Open Position</h2>
            </div>
            <button
              className="text-button"
              type="button"
              onClick={() => setActiveTab('my-jobs')}
            >
              Cancel & View My Jobs
            </button>
          </div>

          <form className="employer-profile-form post-job-form" onSubmit={handleCreateJobSubmit} noValidate>
            <div className="employer-form-grid">
              <div className="form-group form-group-full">
                <label htmlFor="post-job-title">
                  Job Title <span className="req-star">*</span>
                </label>
                <input
                  id="post-job-title"
                  value={postJobForm.title}
                  onChange={(e) => handlePostJobChange('title', e.target.value)}
                  placeholder="e.g. Senior Full Stack Engineer"
                  maxLength="160"
                  required
                />
                {postJobErrors.title && <p className="field-error" role="alert">{postJobErrors.title}</p>}
              </div>

              <div className="form-group">
                <label htmlFor="post-job-company">
                  Company Name <span className="req-star">*</span>
                </label>
                <input
                  id="post-job-company"
                  value={postJobForm.company}
                  onChange={(e) => handlePostJobChange('company', e.target.value)}
                  placeholder="e.g. Acme Studio"
                  maxLength="160"
                  required
                />
                {postJobErrors.company && <p className="field-error" role="alert">{postJobErrors.company}</p>}
              </div>

              <div className="form-group">
                <label htmlFor="post-job-location">
                  Location <span className="req-star">*</span>
                </label>
                <input
                  id="post-job-location"
                  value={postJobForm.location}
                  onChange={(e) => handlePostJobChange('location', e.target.value)}
                  placeholder="e.g. San Francisco, CA or Remote"
                  maxLength="120"
                  required
                />
                {postJobErrors.location && <p className="field-error" role="alert">{postJobErrors.location}</p>}
              </div>

              <div className="form-group">
                <label htmlFor="post-job-remote-type">
                  Work Mode <span className="req-star">*</span>
                </label>
                <select
                  id="post-job-remote-type"
                  value={postJobForm.remote_type}
                  onChange={(e) => handlePostJobChange('remote_type', e.target.value)}
                  required
                >
                  <option value="remote">Remote</option>
                  <option value="hybrid">Hybrid</option>
                  <option value="onsite">Onsite</option>
                </select>
                {postJobErrors.remote_type && <p className="field-error" role="alert">{postJobErrors.remote_type}</p>}
              </div>

              <div className="form-group">
                <label htmlFor="post-job-employment-type">
                  Employment Type <span className="req-star">*</span>
                </label>
                <select
                  id="post-job-employment-type"
                  value={postJobForm.employment_type}
                  onChange={(e) => handlePostJobChange('employment_type', e.target.value)}
                  required
                >
                  <option value="full-time">Full-time</option>
                  <option value="part-time">Part-time</option>
                  <option value="contract">Contract</option>
                  <option value="internship">Internship</option>
                </select>
                {postJobErrors.employment_type && <p className="field-error" role="alert">{postJobErrors.employment_type}</p>}
              </div>

              <div className="form-group">
                <label htmlFor="post-job-industry">
                  Industry <span>(Optional)</span>
                </label>
                <input
                  id="post-job-industry"
                  value={postJobForm.industry}
                  onChange={(e) => handlePostJobChange('industry', e.target.value)}
                  placeholder="e.g. Software, FinTech, Design"
                  maxLength="120"
                />
              </div>

              <div className="form-group">
                <label htmlFor="post-job-source-url">
                  Application / Listing URL <span>(Optional)</span>
                </label>
                <input
                  id="post-job-source-url"
                  type="url"
                  value={postJobForm.source_url}
                  onChange={(e) => handlePostJobChange('source_url', e.target.value)}
                  placeholder="https://company.com/jobs/role-123"
                  maxLength="2048"
                />
              </div>

              <div className="form-group">
                <label htmlFor="post-job-salary-min">
                  Minimum Salary (Annual) <span>(Optional)</span>
                </label>
                <input
                  id="post-job-salary-min"
                  type="number"
                  min="0"
                  step="1000"
                  value={postJobForm.salary_min}
                  onChange={(e) => handlePostJobChange('salary_min', e.target.value)}
                  placeholder="e.g. 120000"
                />
                {postJobErrors.salary_min && <p className="field-error" role="alert">{postJobErrors.salary_min}</p>}
              </div>

              <div className="form-group">
                <label htmlFor="post-job-salary-max">
                  Maximum Salary (Annual) <span>(Optional)</span>
                </label>
                <input
                  id="post-job-salary-max"
                  type="number"
                  min="0"
                  step="1000"
                  value={postJobForm.salary_max}
                  onChange={(e) => handlePostJobChange('salary_max', e.target.value)}
                  placeholder="e.g. 160000"
                />
                {postJobErrors.salary_max && <p className="field-error" role="alert">{postJobErrors.salary_max}</p>}
              </div>

              <div className="form-group form-group-full">
                <label htmlFor="post-job-description">
                  Job Description & Requirements <span className="req-star">*</span>
                </label>
                <textarea
                  id="post-job-description"
                  rows="6"
                  value={postJobForm.description}
                  onChange={(e) => handlePostJobChange('description', e.target.value)}
                  placeholder="Detail responsibilities, core skills, qualifications, and benefits..."
                  required
                />
                {postJobErrors.description && <p className="field-error" role="alert">{postJobErrors.description}</p>}
              </div>
            </div>

            <div className="employer-form-actions">
              <button className="primary-button" type="submit" disabled={postingJob}>
                {postingJob ? (
                  <>
                    <LoaderCircle className="spin" size={15} /> Publishing Listing…
                  </>
                ) : (
                  <>
                    <Check size={15} /> Publish Job Posting
                  </>
                )}
              </button>
              <button
                className="secondary-button"
                type="button"
                onClick={() => setActiveTab('my-jobs')}
                disabled={postingJob}
              >
                Cancel
              </button>
            </div>
          </form>
        </section>
      )}

      {/* 3. COMPANY PROFILE / ONBOARDING TAB */}
      {(!loading && isJobSeeker) || (!loading && !isJobSeeker && activeTab === 'company-profile') ? (
        <>
          <div className="employer-status-card">
            <div className="employer-status-info">
              <span className="employer-status-icon">
                <Building2 size={20} />
              </span>
              <div>
                <div className="employer-role-badge-row">
                  <strong>Account Role:</strong>
                  <span className={`role-badge role-${user?.role || 'job_seeker'}`}>
                    {user?.role === 'employer' ? 'Employer' : user?.role === 'recruiter' ? 'Recruiter' : 'Job Seeker'}
                  </span>
                </div>
                <p>
                  {isJobSeeker
                    ? 'Submitting this onboarding form will promote your account to Employer status.'
                    : 'Your account has active Employer privileges to manage company details and job postings.'}
                </p>
              </div>
            </div>
          </div>

          <section className="profile-details-section employer-form-section" aria-labelledby="company-details-heading">
            <div className="profile-section-heading">
              <div>
                <div className="section-kicker">COMPANY INFORMATION</div>
                <h2 id="company-details-heading">
                  {isEditingProfile ? (isJobSeeker ? 'Create Company Profile' : 'Edit Company Details') : 'Company Details'}
                </h2>
              </div>
              {!isEditingProfile && (
                <button
                  className="text-button"
                  type="button"
                  onClick={() => {
                    setIsEditingProfile(true)
                    setError('')
                    setSuccessMessage('')
                    setProfileFormErrors({})
                  }}
                >
                  <Pencil size={14} /> Edit profile
                </button>
              )}
            </div>

            {isEditingProfile ? (
              <form className="employer-profile-form" onSubmit={handleProfileSubmit} noValidate>
                <div className="employer-form-grid">
                  <div className="form-group">
                    <label htmlFor="emp-company-name">
                      Company Name <span className="req-star">*</span>
                    </label>
                    <input
                      id="emp-company-name"
                      value={profileFormData.company_name}
                      onChange={(e) => handleProfileInputChange('company_name', e.target.value)}
                      placeholder="e.g. Acme Corporation"
                      maxLength="160"
                      required
                    />
                    {profileFormErrors.company_name && <p className="field-error" role="alert">{profileFormErrors.company_name}</p>}
                  </div>

                  <div className="form-group">
                    <label htmlFor="emp-company-website">
                      Company Website <span>(Optional)</span>
                    </label>
                    <input
                      id="emp-company-website"
                      type="url"
                      value={profileFormData.company_website}
                      onChange={(e) => handleProfileInputChange('company_website', e.target.value)}
                      placeholder="https://example.com"
                      maxLength="2048"
                    />
                  </div>

                  <div className="form-group">
                    <label htmlFor="emp-recruiter-name">
                      Recruiter / Contact Name <span className="req-star">*</span>
                    </label>
                    <input
                      id="emp-recruiter-name"
                      value={profileFormData.recruiter_name}
                      onChange={(e) => handleProfileInputChange('recruiter_name', e.target.value)}
                      placeholder="e.g. Sarah Jenkins"
                      maxLength="160"
                      required
                    />
                    {profileFormErrors.recruiter_name && <p className="field-error" role="alert">{profileFormErrors.recruiter_name}</p>}
                  </div>

                  <div className="form-group">
                    <label htmlFor="emp-recruiter-email">
                      Recruiter Email <span className="req-star">*</span>
                    </label>
                    <input
                      id="emp-recruiter-email"
                      type="email"
                      value={profileFormData.recruiter_email}
                      onChange={(e) => handleProfileInputChange('recruiter_email', e.target.value)}
                      placeholder="recruiter@example.com"
                      maxLength="254"
                      required
                    />
                    {profileFormErrors.recruiter_email && <p className="field-error" role="alert">{profileFormErrors.recruiter_email}</p>}
                  </div>

                  <div className="form-group">
                    <label htmlFor="emp-recruiter-phone">
                      Recruiter Phone <span>(Optional)</span>
                    </label>
                    <input
                      id="emp-recruiter-phone"
                      type="tel"
                      value={profileFormData.recruiter_phone}
                      onChange={(e) => handleProfileInputChange('recruiter_phone', e.target.value)}
                      placeholder="+1 (555) 000-0000"
                      maxLength="50"
                    />
                  </div>

                  <div className="form-group form-group-full">
                    <label htmlFor="emp-company-desc">
                      Company Description <span>(Optional)</span>
                    </label>
                    <textarea
                      id="emp-company-desc"
                      rows="3"
                      value={profileFormData.company_description}
                      onChange={(e) => handleProfileInputChange('company_description', e.target.value)}
                      placeholder="Brief overview of your company, mission, or culture..."
                    />
                  </div>
                </div>

                <div className="employer-form-actions">
                  <button className="primary-button" type="submit" disabled={savingProfile}>
                    {savingProfile ? (
                      <>
                        <LoaderCircle className="spin" size={15} /> Saving
                      </>
                    ) : (
                      <>
                        <Check size={15} /> {isJobSeeker ? 'Complete Onboarding & Become a Recruiter' : 'Save Changes'}
                      </>
                    )}
                  </button>
                  {!isJobSeeker && (
                    <button
                      className="secondary-button"
                      type="button"
                      onClick={() => {
                        setIsEditingProfile(false)
                        setProfileFormErrors({})
                        if (profile) {
                          setProfileFormData({
                            company_name: profile.company_name || '',
                            recruiter_name: profile.recruiter_name || '',
                            recruiter_email: profile.recruiter_email || '',
                            company_website: profile.company_website || '',
                            company_description: profile.company_description || '',
                            recruiter_phone: profile.recruiter_phone || '',
                          })
                        }
                      }}
                      disabled={savingProfile}
                    >
                      Cancel
                    </button>
                  )}
                </div>
              </form>
            ) : (
              <div className="profile-details-grid employer-details-grid">
                <div className="profile-detail">
                  <span>Company Name</span>
                  <strong>{profile?.company_name || '—'}</strong>
                </div>
                <div className="profile-detail">
                  <span>Website</span>
                  <strong>
                    {profile?.company_website ? (
                      <a href={profile.company_website.startsWith('http') ? profile.company_website : `https://${profile.company_website}`} target="_blank" rel="noopener noreferrer" className="external-link-text">
                        {profile.company_website} <ExternalLink size={12} />
                      </a>
                    ) : (
                      'Not provided'
                    )}
                  </strong>
                </div>
                <div className="profile-detail">
                  <span>Recruiter / Contact</span>
                  <strong>{profile?.recruiter_name || '—'}</strong>
                </div>
                <div className="profile-detail">
                  <span>Contact Email</span>
                  <strong>{profile?.recruiter_email || '—'}</strong>
                </div>
                <div className="profile-detail">
                  <span>Contact Phone</span>
                  <strong>{profile?.recruiter_phone || 'Not provided'}</strong>
                </div>
                <div className="profile-detail profile-detail-full">
                  <span>About Company</span>
                  <p className="employer-desc-text">{profile?.company_description || 'No company description provided.'}</p>
                </div>
              </div>
            )}
          </section>

          {!isJobSeeker && (
            <section className="employer-upcoming-card">
              <div className="upcoming-icon">
                <BriefcaseBusiness size={20} />
              </div>
              <div className="upcoming-content">
                <div className="section-kicker">READY TO HIRE?</div>
                <h3>Post an Open Job Opportunity</h3>
                <p>
                  Publish your open roles to appear in Job Discovery. Qualified job seekers can instantly view and match against your requirements.
                </p>
                <button
                  className="primary-button small-button"
                  type="button"
                  style={{ marginTop: '12px' }}
                  onClick={() => { setActiveTab('post-job'); setError(''); setSuccessMessage('') }}
                >
                  <Plus size={14} /> Create a Job Posting
                </button>
              </div>
            </section>
          )}
        </>
      ) : null}

      {/* 4. EDIT JOB MODAL */}
      {editingJob && editJobForm && (
        <div
          className="modal-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !savingEditJob) {
              setEditingJob(null)
              setEditJobForm(null)
            }
          }}
        >
          <section className="application-modal job-details-modal" role="dialog" aria-modal="true" aria-labelledby="edit-job-modal-title">
            <div className="modal-heading">
              <div>
                <div className="section-kicker">EDIT JOB LISTING</div>
                <h2 id="edit-job-modal-title">Edit {editingJob.title}</h2>
              </div>
              <button
                className="close-button"
                type="button"
                onClick={() => { setEditingJob(null); setEditJobForm(null) }}
                disabled={savingEditJob}
                aria-label="Close edit job modal"
              >
                ×
              </button>
            </div>

            <form className="employer-profile-form" onSubmit={handleSaveEditedJob} noValidate style={{ padding: '16px 0 0' }}>
              <div className="employer-form-grid">
                <div className="form-group form-group-full">
                  <label htmlFor="edit-job-title">Job Title <span className="req-star">*</span></label>
                  <input
                    id="edit-job-title"
                    value={editJobForm.title}
                    onChange={(e) => setEditJobForm((prev) => ({ ...prev, title: e.target.value }))}
                    required
                  />
                  {editJobErrors.title && <p className="field-error" role="alert">{editJobErrors.title}</p>}
                </div>

                <div className="form-group">
                  <label htmlFor="edit-job-company">Company Name <span className="req-star">*</span></label>
                  <input
                    id="edit-job-company"
                    value={editJobForm.company}
                    onChange={(e) => setEditJobForm((prev) => ({ ...prev, company: e.target.value }))}
                    required
                  />
                  {editJobErrors.company && <p className="field-error" role="alert">{editJobErrors.company}</p>}
                </div>

                <div className="form-group">
                  <label htmlFor="edit-job-location">Location <span className="req-star">*</span></label>
                  <input
                    id="edit-job-location"
                    value={editJobForm.location}
                    onChange={(e) => setEditJobForm((prev) => ({ ...prev, location: e.target.value }))}
                    required
                  />
                  {editJobErrors.location && <p className="field-error" role="alert">{editJobErrors.location}</p>}
                </div>

                <div className="form-group">
                  <label htmlFor="edit-job-remote-type">Work Mode <span className="req-star">*</span></label>
                  <select
                    id="edit-job-remote-type"
                    value={editJobForm.remote_type}
                    onChange={(e) => setEditJobForm((prev) => ({ ...prev, remote_type: e.target.value }))}
                    required
                  >
                    <option value="remote">Remote</option>
                    <option value="hybrid">Hybrid</option>
                    <option value="onsite">Onsite</option>
                  </select>
                </div>

                <div className="form-group">
                  <label htmlFor="edit-job-employment-type">Employment Type <span className="req-star">*</span></label>
                  <select
                    id="edit-job-employment-type"
                    value={editJobForm.employment_type}
                    onChange={(e) => setEditJobForm((prev) => ({ ...prev, employment_type: e.target.value }))}
                    required
                  >
                    <option value="full-time">Full-time</option>
                    <option value="part-time">Part-time</option>
                    <option value="contract">Contract</option>
                    <option value="internship">Internship</option>
                  </select>
                </div>

                <div className="form-group">
                  <label htmlFor="edit-job-industry">Industry <span>(Optional)</span></label>
                  <input
                    id="edit-job-industry"
                    value={editJobForm.industry}
                    onChange={(e) => setEditJobForm((prev) => ({ ...prev, industry: e.target.value }))}
                  />
                </div>

                <div className="form-group">
                  <label htmlFor="edit-job-source-url">Application URL <span>(Optional)</span></label>
                  <input
                    id="edit-job-source-url"
                    type="url"
                    value={editJobForm.source_url}
                    onChange={(e) => setEditJobForm((prev) => ({ ...prev, source_url: e.target.value }))}
                  />
                </div>

                <div className="form-group">
                  <label htmlFor="edit-job-salary-min">Min Salary <span>(Optional)</span></label>
                  <input
                    id="edit-job-salary-min"
                    type="number"
                    min="0"
                    step="1000"
                    value={editJobForm.salary_min}
                    onChange={(e) => setEditJobForm((prev) => ({ ...prev, salary_min: e.target.value }))}
                  />
                  {editJobErrors.salary_min && <p className="field-error" role="alert">{editJobErrors.salary_min}</p>}
                </div>

                <div className="form-group">
                  <label htmlFor="edit-job-salary-max">Max Salary <span>(Optional)</span></label>
                  <input
                    id="edit-job-salary-max"
                    type="number"
                    min="0"
                    step="1000"
                    value={editJobForm.salary_max}
                    onChange={(e) => setEditJobForm((prev) => ({ ...prev, salary_max: e.target.value }))}
                  />
                  {editJobErrors.salary_max && <p className="field-error" role="alert">{editJobErrors.salary_max}</p>}
                </div>

                <div className="form-group form-group-full">
                  <label htmlFor="edit-job-description">Description & Requirements <span className="req-star">*</span></label>
                  <textarea
                    id="edit-job-description"
                    rows="5"
                    value={editJobForm.description}
                    onChange={(e) => setEditJobForm((prev) => ({ ...prev, description: e.target.value }))}
                    required
                  />
                  {editJobErrors.description && <p className="field-error" role="alert">{editJobErrors.description}</p>}
                </div>
              </div>

              {editJobErrors.form && <p className="profile-form-error" role="alert" style={{ marginTop: '12px' }}>{editJobErrors.form}</p>}

              <div className="form-actions" style={{ marginTop: '20px' }}>
                <button
                  className="secondary-button"
                  type="button"
                  onClick={() => { setEditingJob(null); setEditJobForm(null) }}
                  disabled={savingEditJob}
                >
                  Cancel
                </button>
                <button className="primary-button" type="submit" disabled={savingEditJob}>
                  {savingEditJob ? <><LoaderCircle className="spin" size={15} /> Saving…</> : <><Check size={15} /> Save Changes</>}
                </button>
              </div>
            </form>
          </section>
        </div>
      )}

      {/* 5. CANDIDATE DETAILS MODAL */}
      {selectedApplicant && (
        <div
          className="modal-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !updatingApplicantStatus) {
              setSelectedApplicant(null)
              setApplicantModalFeedback({ error: '', success: '' })
            }
          }}
        >
          <section className="application-modal job-details-modal" role="dialog" aria-modal="true" aria-labelledby="applicant-modal-title">
            <div className="modal-heading">
              <div>
                <div className="section-kicker">CANDIDATE APPLICATION</div>
                <h2 id="applicant-modal-title">{selectedApplicant.applicant_name || 'Candidate Details'}</h2>
              </div>
              <button
                className="close-button"
                type="button"
                onClick={() => { setSelectedApplicant(null); setApplicantModalFeedback({ error: '', success: '' }) }}
                disabled={updatingApplicantStatus}
                aria-label="Close candidate modal"
              >
                ×
              </button>
            </div>

            {applicantModalFeedback.error && (
              <div className="profile-alert" role="alert" style={{ margin: '14px 0 0' }}>
                <CircleHelp size={16} /> {applicantModalFeedback.error}
              </div>
            )}

            {applicantModalFeedback.success && (
              <div className="profile-success-banner" role="status" style={{ margin: '14px 0 0' }}>
                <CheckCircle2 size={16} /> {applicantModalFeedback.success}
              </div>
            )}

            <div className="profile-details-grid employer-details-grid" style={{ marginTop: '16px' }}>
              <div className="profile-detail">
                <span>Candidate Name</span>
                <strong>{selectedApplicant.applicant_name || 'Anonymous'}</strong>
              </div>
              <div className="profile-detail">
                <span>Email Address</span>
                <strong>
                  <a href={`mailto:${selectedApplicant.applicant_email}`} className="external-link-text">
                    {selectedApplicant.applicant_email} <ExternalLink size={12} />
                  </a>
                </strong>
              </div>
              <div className="profile-detail">
                <span>Phone Number</span>
                <strong>{selectedApplicant.applicant_phone || 'Not provided'}</strong>
              </div>
              <div className="profile-detail">
                <span>Target Role</span>
                <strong>{selectedApplicant.job_title} ({selectedApplicant.job_company})</strong>
              </div>
              <div className="profile-detail">
                <span>Current Pipeline Stage</span>
                <div style={{ marginTop: '6px' }}>
                  <select
                    className="applicant-status-select"
                    value={selectedApplicant.status}
                    disabled={updatingApplicantStatus}
                    onChange={(e) => handleUpdateApplicantStatus(selectedApplicant.id, e.target.value)}
                  >
                    <option value="Applied">Applied</option>
                    <option value="Interview">Interview</option>
                    <option value="Offer">Offer</option>
                    <option value="Rejected">Rejected</option>
                    <option value="Saved">Saved</option>
                  </select>
                </div>
              </div>
              <div className="profile-detail">
                <span>Applied Date</span>
                <strong>{selectedApplicant.applied_at ? formatDate(selectedApplicant.applied_at) : formatDate(selectedApplicant.created_at)}</strong>
              </div>
              {selectedApplicant.resume_filename && (
                <div className="profile-detail profile-detail-full">
                  <span>Attached Resume</span>
                  <div style={{ marginTop: '4px' }}>
                    <span className="candidate-resume-link" style={{ fontSize: '13px', fontWeight: 600 }}>
                      <FileText size={15} /> {selectedApplicant.resume_filename}
                    </span>
                  </div>
                </div>
              )}
              {selectedApplicant.notes && (
                <div className="profile-detail profile-detail-full">
                  <span>Candidate Notes / Message</span>
                  <p className="employer-desc-text">{selectedApplicant.notes}</p>
                </div>
              )}
            </div>

            <div className="form-actions" style={{ marginTop: '24px', justifyContent: 'flex-end' }}>
              <button
                className="secondary-button"
                type="button"
                onClick={() => { setSelectedApplicant(null); setApplicantModalFeedback({ error: '', success: '' }) }}
                disabled={updatingApplicantStatus}
              >
                Close
              </button>
            </div>
          </section>
        </div>
      )}
    </section>
  )
}

function formatRelativeTime(dateString) {
  if (!dateString) return ''
  const date = new Date(dateString)
  if (Number.isNaN(date.getTime())) return ''
  const now = new Date()
  const diffSec = Math.floor((now - date) / 1000)

  if (diffSec < 60) return 'Just now'
  const diffMin = Math.floor(diffSec / 60)
  if (diffMin < 60) return `${diffMin}m ago`
  const diffHr = Math.floor(diffMin / 60)
  if (diffHr < 24) return `${diffHr}h ago`
  const diffDays = Math.floor(diffHr / 24)
  if (diffDays < 7) return `${diffDays}d ago`
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function formatFileSize(value) {
  const size = Number(value)
  if (!Number.isFinite(size) || size < 0) return 'Size unavailable'
  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(0)} KB`
  return `${(size / (1024 * 1024)).toFixed(1)} MB`
}

function formatDate(value) {
  if (!value) return 'Not listed'
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return 'Not listed'
  return d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
}

function formatSalary(minimum, maximum, currency = 'USD') {
  if (minimum == null && maximum == null) return ''
  const validCurrency = typeof currency === 'string' && /^[A-Za-z]{3}$/.test(currency) ? currency.toUpperCase() : 'USD'
  let format
  try {
    format = new Intl.NumberFormat('en-US', { style: 'currency', currency: validCurrency, maximumFractionDigits: 0 }).format
  } catch {
    format = (n) => `$${Number(n).toLocaleString()}`
  }
  const minNum = minimum != null && minimum !== '' ? Number(minimum) : null
  const maxNum = maximum != null && maximum !== '' ? Number(maximum) : null
  if (minNum != null && maxNum != null) return `${format(minNum)} - ${format(maxNum)}`
  return minNum != null ? `From ${format(minNum)}` : maxNum != null ? `Up to ${format(maxNum)}` : ''
}

function formatEmploymentType(value) {
  if (!value) return 'Not specified'
  const key = String(value).toLowerCase().replace(/[-_\s]/g, '')
  if (key === 'fulltime') return 'Full-time'
  if (key === 'parttime') return 'Part-time'
  if (key === 'contract') return 'Contract'
  if (key === 'internship') return 'Internship'
  return String(value).charAt(0).toUpperCase() + String(value).slice(1)
}

function formatWorkMode(value) {
  if (!value) return 'Not specified'
  const key = String(value).toLowerCase()
  if (key === 'remote') return 'Remote'
  if (key === 'hybrid') return 'Hybrid'
  if (key === 'onsite') return 'Onsite'
  return String(value).charAt(0).toUpperCase() + String(value).slice(1)
}

function emptyPreferences() {
  return {
    target_roles: '',
    locations: '',
    remote_preference: 'any',
    employment_types: '',
    industries: '',
    min_salary: '',
    max_salary: '',
    currency: 'USD',
  }
}

function preferenceFormValues(preferences = {}) {
  return {
    target_roles: (preferences.target_roles ?? []).join(', '),
    locations: (preferences.locations ?? []).join(', '),
    remote_preference: preferences.remote_preference ?? 'any',
    employment_types: (preferences.employment_types ?? []).join(', '),
    industries: (preferences.industries ?? []).join(', '),
    min_salary: preferences.min_salary ?? '',
    max_salary: preferences.max_salary ?? '',
    currency: preferences.currency ?? 'USD',
  }
}

function splitPreferenceValues(value) {
  return value.split(',').map((item) => item.trim()).filter(Boolean)
}

function JobPreferencesModal({ user, onClose }) {
  const [preferences, setPreferences] = useState(emptyPreferences)
  const [preferencesLoading, setPreferencesLoading] = useState(true)
  const [preferencesSaving, setPreferencesSaving] = useState(false)
  const [preferencesExist, setPreferencesExist] = useState(false)
  const [preferencesError, setPreferencesError] = useState('')
  const [preferencesMessage, setPreferencesMessage] = useState('')

  useEffect(() => {
    let active = true
    fetch(`/api/preferences/${user.id}`, { credentials: 'include' })
      .then(async (response) => {
        if (response.status === 404) return null
        const result = await readApiResponse(response)
        if (!response.ok) throw new Error(result.error ?? 'Could not load job preferences.')
        return result
      })
      .then((result) => {
        if (!active) return
        setPreferences(result ? preferenceFormValues(result) : emptyPreferences())
        setPreferencesExist(Boolean(result))
      })
      .catch((loadError) => {
        if (active) setPreferencesError(loadError.message || 'Could not load job preferences.')
      })
      .finally(() => {
        if (active) setPreferencesLoading(false)
      })
    return () => { active = false }
  }, [user.id])

  function updatePreference(field, value) {
    setPreferences((current) => ({ ...current, [field]: value }))
  }

  async function savePreferences(event) {
    event.preventDefault()
    setPreferencesSaving(true)
    setPreferencesError('')
    setPreferencesMessage('')
    const payload = {
      target_roles: splitPreferenceValues(preferences.target_roles),
      locations: splitPreferenceValues(preferences.locations),
      remote_preference: preferences.remote_preference,
      employment_types: splitPreferenceValues(preferences.employment_types),
      industries: splitPreferenceValues(preferences.industries),
      min_salary: preferences.min_salary === '' ? null : Number(preferences.min_salary),
      max_salary: preferences.max_salary === '' ? null : Number(preferences.max_salary),
      currency: preferences.currency.trim().toUpperCase() || 'USD',
    }
    try {
      const response = await fetch(preferencesExist ? `/api/preferences/${user.id}` : '/api/preferences', {
        method: preferencesExist ? 'PUT' : 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(preferencesExist ? payload : { ...payload, user_id: user.id }),
      })
      const result = await readApiResponse(response)
      if (!response.ok) throw new Error(result.error ?? 'Could not save job preferences.')
      setPreferences(preferenceFormValues(result))
      setPreferencesExist(true)
      setPreferencesMessage('Job preferences saved.')
    } catch (saveError) {
      setPreferencesError(saveError.message || 'Could not save job preferences.')
    } finally {
      setPreferencesSaving(false)
    }
  }

  return <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !preferencesSaving) onClose() }}>
    <section className="application-modal" role="dialog" aria-modal="true" aria-labelledby="preferences-title">
      <div className="modal-heading"><div><div className="section-kicker">JOB DISCOVERY</div><h2 id="preferences-title">Job preferences</h2></div><button className="close-button" type="button" onClick={onClose} disabled={preferencesSaving} aria-label="Close job preferences">×</button></div>
      {preferencesLoading ? <div className="profile-loading" role="status"><LoaderCircle className="spin" size={17} /> Loading preferences</div> : <form className="application-form" onSubmit={savePreferences}>
        <label>Target roles<input value={preferences.target_roles} onChange={(event) => updatePreference('target_roles', event.target.value)} placeholder="Product designer, researcher" /></label>
        <label>Locations<input value={preferences.locations} onChange={(event) => updatePreference('locations', event.target.value)} placeholder="Remote, New York" /></label>
        <label>Remote preference<select value={preferences.remote_preference} onChange={(event) => updatePreference('remote_preference', event.target.value)}><option value="any">Any</option><option value="remote">Remote</option><option value="hybrid">Hybrid</option><option value="onsite">Onsite</option></select></label>
        <label>Employment types<input value={preferences.employment_types} onChange={(event) => updatePreference('employment_types', event.target.value)} placeholder="Full-time, contract" /></label>
        <label>Industries<input value={preferences.industries} onChange={(event) => updatePreference('industries', event.target.value)} placeholder="Software, healthcare" /></label>
        <label>Minimum salary<input type="number" min="0" value={preferences.min_salary} onChange={(event) => updatePreference('min_salary', event.target.value)} /></label>
        <label>Maximum salary<input type="number" min="0" value={preferences.max_salary} onChange={(event) => updatePreference('max_salary', event.target.value)} /></label>
        <label>Currency<input value={preferences.currency} onChange={(event) => updatePreference('currency', event.target.value)} minLength="3" maxLength="3" pattern="[A-Za-z]{3}" /></label>
        {preferencesError && <div className="notice" role="alert"><CircleHelp size={16} /> {preferencesError}</div>}
        {preferencesMessage && <p className="profile-form-success" role="status">{preferencesMessage}</p>}
        <div className="form-actions"><button className="secondary-button" type="button" onClick={onClose} disabled={preferencesSaving}>Cancel</button><button className="primary-button" type="submit" disabled={preferencesSaving}>{preferencesSaving ? <><LoaderCircle className="spin" size={16} /> Saving</> : <><Check size={16} /> Save preferences</>}</button></div>
      </form>}
    </section>
  </div>
}

function ResumeSection({ onBack }) {
  const [resume, setResume] = useState(null)
  const [resumeLoading, setResumeLoading] = useState(true)
  const [resumeError, setResumeError] = useState('')
  const [selectedFile, setSelectedFile] = useState(null)
  const [uploading, setUploading] = useState(false)
  const [uploadProgress, setUploadProgress] = useState(0)
  const [uploadMessage, setUploadMessage] = useState('')
  const [uploadError, setUploadError] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const fileInput = useRef(null)

  async function loadResume() {
    setResumeLoading(true)
    setResumeError('')
    try {
      const response = await fetch('/api/resumes/me', { credentials: 'include' })
      if (response.status === 404) {
        setResume(null)
        return
      }
      const result = await readApiResponse(response)
      if (!response.ok) throw new Error(result.error ?? 'Could not load your resume.')
      setResume(result)
    } catch (error) {
      setResumeError(error.message || 'Could not load your resume.')
    } finally {
      setResumeLoading(false)
    }
  }

  useEffect(() => {
    let active = true
    fetch('/api/resumes/me', { credentials: 'include' })
      .then(async (response) => {
        if (response.status === 404) return null
        const result = await readApiResponse(response)
        if (!response.ok) throw new Error(result.error ?? 'Could not load your resume.')
        return result
      })
      .then((result) => {
        if (active) setResume(result)
      })
      .catch((error) => {
        if (active) setResumeError(error.message || 'Could not load your resume.')
      })
      .finally(() => {
        if (active) setResumeLoading(false)
      })
    return () => { active = false }
  }, [])

  function chooseResume(event) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    const extension = file.name.split('.').pop()?.toLowerCase()
    if (!['pdf', 'docx'].includes(extension)) {
      setUploadError('Choose a PDF or DOCX file.')
      setUploadMessage('')
      return
    }
    if (file.size > 10 * 1024 * 1024) {
      setUploadError('Choose a file smaller than 10 MB.')
      setUploadMessage('')
      return
    }
    setSelectedFile(file)
    setUploadError('')
    setUploadMessage('')
    setUploadProgress(0)
  }

  function cancelSelection() {
    setSelectedFile(null)
    setUploadError('')
    setUploadMessage('')
    setUploadProgress(0)
  }

  async function saveResume() {
    if (!selectedFile) return
    setUploading(true)
    setUploadProgress(0)
    setUploadError('')
    setUploadMessage('')
    try {
      const result = await new Promise((resolve, reject) => {
        const form = new FormData()
        form.append('file', selectedFile, selectedFile.name)
        const xhr = new XMLHttpRequest()
        xhr.open(resume ? 'PUT' : 'POST', resume ? `/api/resumes/${resume.id}/file` : '/api/resumes/upload')
        xhr.withCredentials = true
        xhr.upload.addEventListener('progress', (event) => {
          if (event.lengthComputable) setUploadProgress(Math.round((event.loaded / event.total) * 100))
        })
        xhr.onload = () => {
          let responseBody = {}
          try { responseBody = JSON.parse(xhr.responseText || '{}') } catch {}
          if (xhr.status >= 200 && xhr.status < 300) resolve(responseBody)
          else reject(new Error(responseBody.error ?? 'Could not upload your resume.'))
        }
        xhr.onerror = () => reject(new Error('Upload failed. Check your connection and try again.'))
        xhr.send(form)
      })
      setResume(result)
      setSelectedFile(null)
      setUploadProgress(100)
      setUploadMessage(resume ? 'Resume replaced successfully.' : 'Resume uploaded successfully.')
      setConfirmDelete(false)
    } catch (error) {
      setUploadError(error.message || 'Could not upload your resume.')
    } finally {
      setUploading(false)
    }
  }

  async function deleteResume() {
    if (!resume) return
    setDeleting(true)
    setUploadError('')
    setUploadMessage('')
    try {
      const response = await fetch(`/api/resumes/${resume.id}`, { method: 'DELETE', credentials: 'include' })
      const result = await readApiResponse(response)
      if (!response.ok) throw new Error(result.error ?? 'Could not delete your resume.')
      setResume(null)
      setSelectedFile(null)
      setConfirmDelete(false)
      setUploadMessage('Resume deleted.')
    } catch (error) {
      setUploadError(error.message || 'Could not delete your resume.')
    } finally {
      setDeleting(false)
    }
  }

  return (
    <section className="resume-view" aria-labelledby="resume-title">
      <header className="resume-page-heading">
        <div>
          <div className="section-kicker">CAREER MATERIALS</div>
          <h1 id="resume-title">Your resume</h1>
          <p className="welcome-subtitle">Keep the latest version ready for your next opportunity.</p>
        </div>
        <button className="secondary-button resume-back" type="button" onClick={onBack}><ArrowLeft size={15} /> Back to overview</button>
      </header>

      {resumeLoading && <div className="resume-loading" role="status"><LoaderCircle className="spin" size={17} /> Loading your resume</div>}
      {resumeError && <div className="resume-alert" role="alert"><CircleHelp size={16} /> {resumeError}<button type="button" onClick={loadResume}>Retry</button></div>}

      {!resumeLoading && !resumeError && !resume && <div className="resume-empty">
        <span className="resume-empty-icon"><FileText size={23} /></span>
        <div className="section-kicker">ONE FILE, ALWAYS CURRENT</div>
        <h2>Start with your resume</h2>
        <p>Upload a PDF or DOCX. You can replace or remove it at any time.</p>
        <button className="primary-button" type="button" onClick={() => fileInput.current?.click()} disabled={uploading}>
          <Upload size={16} /> Upload resume
        </button>
      </div>}

      <input ref={fileInput} className="visually-hidden" type="file" accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document" onChange={chooseResume} />

      {selectedFile && <div className="resume-selected-file">
        <span className="resume-file-icon"><FileText size={20} /></span>
        <span className="resume-selected-copy"><strong>{selectedFile.name}</strong><small>{formatFileSize(selectedFile.size)} · Ready to {resume ? 'replace' : 'upload'}</small></span>
        <button className="resume-cancel-selection" type="button" onClick={cancelSelection} disabled={uploading}>Cancel</button>
      </div>}

      {selectedFile && <div className="resume-save-row">
        <button className="primary-button" type="button" onClick={saveResume} disabled={uploading}>
          {uploading ? <><LoaderCircle className="spin" size={15} /> {resume ? 'Replacing resume' : 'Uploading resume'}</> : <><Check size={15} /> {resume ? 'Save replacement' : 'Upload resume'}</>}
        </button>
        {!uploading && <button className="secondary-button" type="button" onClick={cancelSelection}>Cancel</button>}
      </div>}

      {uploading && <div className="resume-progress" role="progressbar" aria-label="Resume upload progress" aria-valuemin="0" aria-valuemax="100" aria-valuenow={uploadProgress}>
        <div><span style={{ width: `${uploadProgress}%` }} /></div><span>{uploadProgress}%</span>
      </div>}
      {uploadError && <p className="resume-feedback error" role="alert">{uploadError}</p>}
      {uploadMessage && <p className="resume-feedback success" role="status">{uploadMessage}</p>}

      {!resumeLoading && resume && <article className="resume-card">
        <div className="resume-card-main">
          <span className="resume-file-icon"><FileText size={23} /></span>
          <div className="resume-card-copy">
            <div className="resume-card-label">CURRENT RESUME <span className="resume-current-badge"><CheckCircle2 size={12} /> Current</span></div>
            <h2>{resume.source_filename || resume.title}</h2>
            <dl className="resume-metadata">
              <div><dt>Format</dt><dd>{resume.mime_type === 'application/pdf' ? 'PDF' : 'DOCX'}</dd></div>
              <div><dt>Size</dt><dd>{formatFileSize(resume.file_size_bytes)}</dd></div>
              <div><dt>Uploaded</dt><dd>{formatDate(resume.created_at)}</dd></div>
            </dl>
          </div>
        </div>
        <div className="resume-card-actions">
          <a className="primary-button resume-download" href={`/api/resumes/${resume.id}/file`} target="_blank" rel="noreferrer">
            <FileDown size={16} /> View / download
          </a>
          <button className="secondary-button" type="button" onClick={() => fileInput.current?.click()} disabled={uploading || deleting}>
            <Upload size={15} /> Replace
          </button>
          {!confirmDelete && <button className="resume-delete-button" type="button" onClick={() => setConfirmDelete(true)} disabled={uploading || deleting}>
            <Trash2 size={15} /> Delete
          </button>}
        </div>
        {confirmDelete && <div className="resume-delete-confirm" role="group" aria-label="Confirm resume deletion">
          <span>Delete this resume and its stored file?</span>
          <button className="resume-delete-confirm-button" type="button" onClick={deleteResume} disabled={deleting}>{deleting ? <><LoaderCircle className="spin" size={14} /> Deleting</> : 'Delete resume'}</button>
          <button className="resume-delete-cancel" type="button" onClick={() => setConfirmDelete(false)} disabled={deleting}>Keep resume</button>
        </div>}
      </article>}
    </section>
  )
}

function Workspace() {
  const [jobs, setJobs] = useState([])
  const [filter, setFilter] = useState('All applications')
  const [search, setSearch] = useState('')
  const [showForm, setShowForm] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [user, setUser] = useState(null)
  const [authChecking, setAuthChecking] = useState(true)
  const [authOpen, setAuthOpen] = useState(false)
  const [authRoleIntent, setAuthRoleIntent] = useState('job_seeker')
  const [authMode, setAuthMode] = useState('login')
  const [authStep, setAuthStep] = useState('email')
  const [authEmail, setAuthEmail] = useState('')
  const [authName, setAuthName] = useState('')
  const [authCode, setAuthCode] = useState('')
  const [authBusy, setAuthBusy] = useState(false)
  const [logoutBusy, setLogoutBusy] = useState(false)
  const [authError, setAuthError] = useState('')
  const [authMessage, setAuthMessage] = useState('')
  const [resendIn, setResendIn] = useState(0)
  const [showProfile, setShowProfile] = useState(false)
  const [showResume, setShowResume] = useState(false)
  const [showAppProfile, setShowAppProfile] = useState(false)
  const [showEmployer, setShowEmployer] = useState(false)
  const [activeSection, setActiveSection] = useState('overview')
  const [discoveryJobs, setDiscoveryJobs] = useState([])
  const [discoverySearch, setDiscoverySearch] = useState('')
  const [discoveryLoading, setDiscoveryLoading] = useState(true)
  const [discoveryError, setDiscoveryError] = useState('')
  const [selectedDiscoveryJob, setSelectedDiscoveryJob] = useState(null)
  const [discoverySaving, setDiscoverySaving] = useState(false)
  const [discoverySaveError, setDiscoverySaveError] = useState('')
  const [showPreferences, setShowPreferences] = useState(false)
  const [discoveryMatches, setDiscoveryMatches] = useState({})
  const [discoverySort, setDiscoverySort] = useState('Best Match')
  const [sourceFilter, setSourceFilter] = useState('all')
  const [discoveryPage, setDiscoveryPage] = useState(1)
  const [discoveryTotalPages, setDiscoveryTotalPages] = useState(1)
  const [discoveryTotalResults, setDiscoveryTotalResults] = useState(0)
  const [workModeFilter, setWorkModeFilter] = useState('Any')
  const [employmentTypeFilter, setEmploymentTypeFilter] = useState('Any')
  const [locationFilter, setLocationFilter] = useState('')
  const [minSalaryFilter, setMinSalaryFilter] = useState('')
  const [matchStatusUpdating, setMatchStatusUpdating] = useState(false)
  const [matchStatusFeedback, setMatchStatusFeedback] = useState({ error: '', success: '' })
  const [applyFeedback, setApplyFeedback] = useState({ status: '', message: '' })
  const [selectedApplication, setSelectedApplication] = useState(null)
  const [applicationUpdating, setApplicationUpdating] = useState(false)
  const [applicationModalFeedback, setApplicationModalFeedback] = useState({ error: '', success: '' })
  const [aiExplaining, setAiExplaining] = useState(false)
  const [aiExplanation, setAiExplanation] = useState({})
  const [aiExplanationError, setAiExplanationError] = useState('')
  const [selectedRagQuestion, setSelectedRagQuestion] = useState(PRESET_RAG_QUESTIONS[0])
  const [ragAnalysisLoading, setRagAnalysisLoading] = useState(false)
  const [ragAnalyses, setRagAnalyses] = useState({})
  const [ragAnalysisError, setRagAnalysisError] = useState('')
  const [expandedEvidence, setExpandedEvidence] = useState({})
  
  // Step 12.5 — Kitty Career AI Assistant State
  const [kittyOpen, setKittyOpen] = useState(false)
  const [kittyConversationId, setKittyConversationId] = useState(null)
  const [kittyMessages, setKittyMessages] = useState([])
  const [kittyInput, setKittyInput] = useState('')
  const [kittyLoading, setKittyLoading] = useState(false)
  const [kittyError, setKittyError] = useState('')
  const [kittyActiveJob, setKittyActiveJob] = useState(null)
  const kittyMessagesEndRef = useRef(null)

  useEffect(() => {
    if (kittyOpen && kittyMessagesEndRef.current) {
      kittyMessagesEndRef.current.scrollIntoView({ behavior: 'smooth' })
    }
  }, [kittyMessages, kittyLoading, kittyOpen])

  async function sendKittyMessage(textToSend = null) {
    const text = (textToSend || kittyInput).trim()
    if (!text || kittyLoading) return

    setKittyLoading(true)
    setKittyError('')
    const userMsg = { role: 'user', content: text, created_at: new Date().toISOString() }
    setKittyMessages((prev) => [...prev, userMsg])
    if (!textToSend) setKittyInput('')

    try {
      const response = await fetch('/api/ai/kitty', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: text,
          conversation_id: kittyConversationId || undefined,
          job_id: kittyActiveJob?.id || undefined,
        }),
      })

      const result = await readApiResponse(response)
      if (!response.ok) {
        if (result.code === 'AI_UNAVAILABLE') {
          throw new Error('Kitty is currently resting. Please verify Ollama is running locally at http://127.0.0.1:11434.')
        }
        throw new Error(result.error || result.message || 'Could not reach Kitty.')
      }

      if (result.conversation_id && !kittyConversationId) {
        setKittyConversationId(result.conversation_id)
      }

      const assistantMsg = {
        role: 'assistant',
        content: result.answer,
        sources: result.sources || [],
        deterministic_match: result.deterministic_match || null,
        created_at: new Date().toISOString(),
      }
      setKittyMessages((prev) => [...prev, assistantMsg])
    } catch (err) {
      setKittyError(err.message || 'Could not get response from Kitty.')
    } finally {
      setKittyLoading(false)
    }
  }

  function startNewKittyChat() {
    setKittyConversationId(null)
    setKittyMessages([])
    setKittyError('')
    setKittyInput('')
  }

  function openKittyWithJob(job) {
    setKittyActiveJob(job)
    setKittyOpen(true)
  }

  const userId = user?.id

  async function explainMatchWithAI(jobId) {
    if (!jobId || aiExplaining) return
    setAiExplaining(true)
    setAiExplanationError('')
    try {
      const response = await fetch('/api/ai/job-explanation', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ job_id: jobId }),
      })
      const result = await readApiResponse(response)
      if (!response.ok) {
        if (result.code === 'AI_UNAVAILABLE') {
          throw new Error('Local AI service is offline. Ensure Ollama is running.')
        }
        throw new Error(result.error ?? result.message ?? 'Could not generate match explanation.')
      }
      setAiExplanation((prev) => ({ ...prev, [jobId]: result }))
    } catch (err) {
      setAiExplanationError(err.message || 'Could not explain match with local AI.')
    } finally {
      setAiExplaining(false)
    }
  }

  async function askRagMatch(jobId, question = selectedRagQuestion) {
    if (!jobId || ragAnalysisLoading) return
    setRagAnalysisLoading(true)
    setRagAnalysisError('')
    try {
      const response = await fetch('/api/ai/rag/job-match', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ job_id: jobId, question }),
      })
      const result = await readApiResponse(response)
      if (!response.ok) {
        if (result.code === 'AI_UNAVAILABLE' || result.code === 'EMBEDDING_UNAVAILABLE') {
          throw new Error('Local AI service or embeddings are offline. Ensure Ollama is running.')
        }
        throw new Error(result.error ?? result.message ?? 'Could not generate RAG match analysis.')
      }
      setRagAnalyses((prev) => ({ ...prev, [jobId]: result }))
    } catch (err) {
      setRagAnalysisError(err.message || 'Could not explain match with local RAG AI.')
    } finally {
      setRagAnalysisLoading(false)
    }
  }

  async function loadApplications() {
    setLoading(true)
    try {
      setJobs(await requestApplications())
      setError('')
    } catch (loadError) {
      setJobs([])
      setError(loadError.status === 401 ? 'Sign in to view your saved applications.' : 'Could not load applications. Check the API and database.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    let active = true
    fetch('/api/auth/me', { credentials: 'include' })
      .then(async (response) => {
        if (response.status === 401) return null
        if (!response.ok) throw new Error('Session lookup failed')
        return response.json()
      })
      .then((result) => {
        if (active) setUser(result?.user ?? null)
      })
      .catch(() => {
        if (active) setUser(null)
      })
      .finally(() => {
        if (active) setAuthChecking(false)
      })
    requestApplications()
      .then((result) => {
        if (active) {
          setJobs(result)
          setError('')
        }
      })
      .catch(() => {
        if (active) setError('Sign in to view your saved applications.')
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => { active = false }
  }, [])

  useEffect(() => {
    let active = true
    setDiscoveryLoading(true)
    requestDiscoveryJobs({
      keywords: discoverySearch,
      location: locationFilter,
      workMode: workModeFilter,
      employmentType: employmentTypeFilter,
      minSalary: minSalaryFilter,
      source: sourceFilter,
      page: discoveryPage,
      sort: discoverySort,
      country: 'in',
    })
      .then((result) => {
        if (active) {
          setDiscoveryJobs(result.jobs || [])
          setDiscoveryTotalPages(result.pagination?.total_pages || 1)
          setDiscoveryTotalResults(result.pagination?.total_results || 0)
          setDiscoveryError('')
        }
      })
      .catch((err) => {
        if (active) {
          setDiscoveryJobs([])
          setDiscoveryError(err.message || 'Could not load open jobs. Check the API and database.')
        }
      })
      .finally(() => {
        if (active) setDiscoveryLoading(false)
      })
    return () => { active = false }
  }, [discoverySearch, locationFilter, workModeFilter, employmentTypeFilter, minSalaryFilter, sourceFilter, discoveryPage, discoverySort, user])


  useEffect(() => {
    if (!userId) return undefined
    let active = true
    async function loadDiscoveryMatches() {
      try {
        const refreshResponse = await fetch('/api/matches/refresh', {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ user_id: userId }),
        })
        if (!refreshResponse.ok) throw new Error('Could not refresh job matches.')
        const matchesResponse = await fetch(`/api/matches?user_id=${userId}`, { credentials: 'include' })
        const result = await readApiResponse(matchesResponse)
        if (!matchesResponse.ok) throw new Error(result.error ?? 'Could not load job matches.')
        if (active) setDiscoveryMatches(Object.fromEntries(result.map((match) => [match.job_id, match])))
      } catch {
        if (active) setDiscoveryMatches({})
      }
    }
    loadDiscoveryMatches()
    return () => { active = false }
  }, [userId])

  useEffect(() => {
    if (!authOpen || authStep !== 'verify' || resendIn <= 0) return undefined
    const timer = window.setTimeout(() => setResendIn((current) => Math.max(0, current - 1)), 1000)
    return () => window.clearTimeout(timer)
  }, [authOpen, authStep, resendIn])

  function openAuth(intent = 'job_seeker') {
    setAuthRoleIntent(intent)
    setAuthMode('login')
    setAuthStep('email')
    setAuthCode('')
    setAuthError('')
    setAuthMessage('')
    setAuthOpen(true)
  }

  function closeAuth() {
    if (authBusy) return
    setAuthOpen(false)
    setAuthError('')
    setAuthMessage('')
  }

  function openApplicationForm() {
    if (!user) {
      openAuth('job_seeker')
      return
    }
    setShowForm(true)
  }

  async function sendOtp(event) {
    event?.preventDefault()
    setAuthBusy(true)
    setAuthError('')
    setAuthMessage('')
    try {
      const response = await fetch('/api/auth/otp/request', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: authEmail.trim() }),
      })
      const result = await readApiResponse(response)
      if (!response.ok) throw new Error(result.error ?? 'Could not send a sign-in code.')
      setAuthStep('verify')
      setAuthCode('')
      setAuthMessage(result.message ?? 'Check your email for a six-digit code.')
      setResendIn(30)
    } catch (requestError) {
      setAuthError(requestError.message || 'Could not send a sign-in code. Try again.')
    } finally {
      setAuthBusy(false)
    }
  }

  async function verifyOtp(event) {
    event.preventDefault()
    setAuthBusy(true)
    setAuthError('')
    try {
      const payload = { email: authEmail.trim(), code: authCode.trim() }
      if (authMode === 'signup') payload.full_name = authName.trim()
      const response = await fetch('/api/auth/otp/verify', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const result = response.status === 204 ? {} : await readApiResponse(response)
      if (!response.ok) throw new Error(result.error ?? 'That code could not be verified.')
      const verifiedUser = result.user
      setUser(verifiedUser)
      setAuthStep('success')
      setAuthError('')

      if (authRoleIntent === 'recruiter') {
        setShowProfile(false)
        setShowResume(false)
        setShowEmployer(true)
        if (verifiedUser.role === 'employer' || verifiedUser.role === 'recruiter') {
          setAuthMessage('Welcome to your Recruiter Workspace.')
        } else {
          setAuthMessage("Sign-in verified. Let's set up your recruiter and company profile.")
        }
      } else {
        setShowEmployer(false)
        setShowProfile(false)
        setShowResume(false)
        setActiveSection('overview')
        setAuthMessage('Your session is ready. Your application workspace is now available.')
        await loadApplications()
      }
    } catch (verificationError) {
      setAuthError(verificationError.message || 'That code could not be verified. Request another code.')
    } finally {
      setAuthBusy(false)
    }
  }

  async function logout() {
    setLogoutBusy(true)
    try {
      const response = await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' })
      if (!response.ok) throw new Error('Could not sign out. Try again.')
      setUser(null)
      setJobs([])
      setShowProfile(false)
      setShowResume(false)
      setShowEmployer(false)
      setShowPreferences(false)
      setDiscoveryMatches({})
      setError('Sign in to view your saved applications.')
      setShowForm(false)
    } catch (logoutError) {
      setError(logoutError.message || 'Could not sign out. Try again.')
    } finally {
      setLogoutBusy(false)
    }
  }

  async function addApplication(event) {
    event.preventDefault()
    setSaving(true)
    const payload = Object.fromEntries(new FormData(event.currentTarget).entries())
    try {
      const response = await fetch('/api/applications', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (!response.ok) throw new Error('Could not save application')
      const job = await response.json()
      setJobs((current) => [job, ...current])
      setShowForm(false)
      setError('')
    } catch {
      setError('Could not save this application. Check that the API and database are running.')
    } finally {
      setSaving(false)
    }
  }

  async function saveDiscoveredJob() {
    if (!selectedDiscoveryJob || jobs.some((job) => job.job_id === selectedDiscoveryJob.id)) return
    setDiscoverySaving(true)
    setDiscoverySaveError('')
    try {
      const response = await fetch('/api/applications', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ job_id: selectedDiscoveryJob.id, status: 'Saved' }),
      })
      const result = await readApiResponse(response)
      if (!response.ok) throw new Error(result.error ?? 'Could not save this job.')
      setJobs((current) => current.some((job) => job.job_id === selectedDiscoveryJob.id) ? current : [result, ...current])
    } catch (saveError) {
      setDiscoverySaveError(saveError.message || 'Could not save this job.')
    } finally {
      setDiscoverySaving(false)
    }
  }

  async function handleApplyExternalClick(job) {
    if (!job) return
    if (!user) {
      setApplyFeedback({ status: 'info', message: 'Sign in to automatically track applications in your pipeline.' })
      return
    }

    const alreadyTracked = jobs.some((j) => j.job_id === job.id)
    if (alreadyTracked) {
      setApplyFeedback({ status: 'tracked', message: 'Application is already tracked in your pipeline.' })
      return
    }

    try {
      const response = await fetch('/api/applications', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          job_id: job.id,
          company: job.company,
          role: job.title,
          location: job.location || '',
          source_url: job.source_url || '',
          status: 'Applied',
        }),
      })
      const result = await readApiResponse(response)
      if (!response.ok) {
        throw new Error(result.error ?? 'Could not track application.')
      }
      setJobs((current) => current.some((j) => j.job_id === job.id || j.id === result.id) ? current : [result, ...current])
      setApplyFeedback({ status: 'success', message: 'Application tracked in your pipeline.' })
    } catch (err) {
      setApplyFeedback({ status: 'error', message: err.message || 'Could not track application automatically.' })
    }
  }

  async function updateModalApplicationStage(status) {
    if (!selectedApplication || applicationUpdating) return
    setApplicationUpdating(true)
    setApplicationModalFeedback({ error: '', success: '' })
    try {
      const response = await fetch(`/api/applications/${selectedApplication.id}`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      })
      const result = await readApiResponse(response)
      if (!response.ok) throw new Error(result.error ?? 'Could not update application status.')
      setJobs((current) => current.map((job) => job.id === selectedApplication.id ? result : job))
      setSelectedApplication(result)
      setApplicationModalFeedback({ error: '', success: `Status updated to ${status}.` })
    } catch (err) {
      setApplicationModalFeedback({ error: err.message || 'Could not update status.', success: '' })
    } finally {
      setApplicationUpdating(false)
    }
  }

  async function updateStage(id, status) {
    try {
      const response = await fetch(`/api/applications/${id}`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      })
      if (!response.ok) throw new Error('Could not update application')
      const updatedJob = await response.json()
      setJobs((current) => current.map((job) => job.id === id ? updatedJob : job))
    } catch {
      setError('Could not update the application stage. Please try again.')
    }
  }

  const visibleJobs = jobs.filter((job) => {
    const matchesStage = filter === 'All applications' || job.status === filter
    const query = search.trim().toLowerCase()
    const matchesSearch = !query || `${job.company} ${job.role} ${job.location}`.toLowerCase().includes(query)
    return matchesStage && matchesSearch
  })
  const activeCount = jobs.filter((job) => !['Rejected', 'Offer'].includes(job.status)).length
  const interviewCount = jobs.filter((job) => job.status === 'Interview').length
  const offerCount = jobs.filter((job) => job.status === 'Offer').length

  async function updateMatchStatus(matchId, newStatus) {
    if (!userId || !matchId || matchStatusUpdating) return
    setMatchStatusUpdating(true)
    setMatchStatusFeedback({ error: '', success: '' })
    try {
      const response = await fetch(`/api/matches/${matchId}`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_id: userId, status: newStatus }),
      })
      const result = await readApiResponse(response)
      if (!response.ok) throw new Error(result.error ?? 'Could not update match status.')
      setDiscoveryMatches((current) => ({
        ...current,
        [result.job_id]: { ...current[result.job_id], ...result },
      }))
      setMatchStatusFeedback({ error: '', success: `Match marked as ${newStatus}.` })
    } catch (err) {
      setMatchStatusFeedback({ error: err.message || 'Could not update match status.', success: '' })
    } finally {
      setMatchStatusUpdating(false)
    }
  }
  const filteredDiscoveryJobs = discoveryJobs.filter((job) => {
    const query = discoverySearch.trim().toLowerCase()
    const matchesKeyword =
      !query ||
      [job.title, job.company, job.location, job.industry].some(
        (field) => typeof field === 'string' && field.toLowerCase().includes(query),
      )

    const matchesWorkMode =
      workModeFilter === 'Any' ||
      (job.remote_type && job.remote_type.toLowerCase() === workModeFilter.toLowerCase())

    const norm = (str) => (str || '').toLowerCase().replace(/[-_\s]/g, '')
    const matchesEmploymentType =
      employmentTypeFilter === 'Any' ||
      (job.employment_type && norm(job.employment_type) === norm(employmentTypeFilter))

    const locQuery = locationFilter.trim().toLowerCase()
    const matchesLocation = !locQuery || (job.location && job.location.toLowerCase().includes(locQuery))

    const minSal = parseFloat(minSalaryFilter)
    const hasMinSal = Boolean(minSalaryFilter.trim()) && !isNaN(minSal) && minSal > 0
    const maxSalaryNum = typeof job.salary_max === 'number' ? job.salary_max : job.salary_max != null ? parseFloat(job.salary_max) : null
    const minSalaryNum = typeof job.salary_min === 'number' ? job.salary_min : job.salary_min != null ? parseFloat(job.salary_min) : null
    const matchesSalary = !hasMinSal
      ? true
      : (maxSalaryNum !== null && !isNaN(maxSalaryNum) && maxSalaryNum >= minSal) ||
        (maxSalaryNum === null && minSalaryNum !== null && !isNaN(minSalaryNum) && minSalaryNum >= minSal)

    return matchesKeyword && matchesWorkMode && matchesEmploymentType && matchesLocation && matchesSalary
  })

  const sortedDiscoveryJobs = discoverySort === 'Best Match'
    ? [...filteredDiscoveryJobs].sort((a, b) => {
        const scoreA = discoveryMatches[a.id]?.score
        const scoreB = discoveryMatches[b.id]?.score
        const hasA = typeof scoreA === 'number'
        const hasB = typeof scoreB === 'number'
        if (hasA && hasB) return scoreB - scoreA
        if (hasA) return -1
        if (hasB) return 1
        return 0
      })
    : filteredDiscoveryJobs

  return (
    <div className="workspace-shell">
      <aside className="sidebar">
        <a className="brand" href="#overview" aria-label="Career Studio home">
          <span className="brand-mark"><BriefcaseBusiness size={18} /></span>
          <span>career<span className="brand-light">studio</span></span>
        </a>
        <div className="workspace-label">WORKSPACE</div>
        <nav className="main-nav" aria-label="Main navigation">
          <a className={!showProfile && !showResume && !showEmployer && !showAppProfile && activeSection === 'overview' ? 'nav-link active' : 'nav-link'} href="#overview" onClick={() => { setShowProfile(false); setShowResume(false); setShowEmployer(false); setShowAppProfile(false); setActiveSection('overview') }}><LayoutDashboard size={17} /> Overview</a>
          <a className={!showProfile && !showResume && !showEmployer && !showAppProfile && activeSection === 'applications' ? 'nav-link active' : 'nav-link'} href="#applications" onClick={() => { setShowProfile(false); setShowResume(false); setShowEmployer(false); setShowAppProfile(false); setActiveSection('applications') }}><BriefcaseBusiness size={17} /> Applications <span className="nav-count">{jobs.length}</span></a>
          {user && <button className={showAppProfile ? 'nav-link nav-action active' : 'nav-link nav-action'} type="button" onClick={() => { setShowProfile(false); setShowResume(false); setShowEmployer(false); setShowAppProfile(true) }}><SlidersHorizontal size={17} /> Application Profile</button>}
          {user && <button className={showResume ? 'nav-link nav-action active' : 'nav-link nav-action'} type="button" onClick={() => { setShowProfile(false); setShowEmployer(false); setShowAppProfile(false); setShowResume(true) }}><FileText size={17} /> Resume</button>}
          {user && (user.role === 'employer' || user.role === 'recruiter') && (
            <button className={showEmployer ? 'nav-link nav-action active' : 'nav-link nav-action'} type="button" onClick={() => { setShowProfile(false); setShowResume(false); setShowAppProfile(false); setShowEmployer(true) }}><Building2 size={17} /> Company Profile</button>
          )}
          {user && <button className={showProfile ? 'nav-link nav-action active' : 'nav-link nav-action'} type="button" onClick={() => { setShowResume(false); setShowEmployer(false); setShowAppProfile(false); setShowProfile(true) }}><UserRound size={17} /> Profile</button>}
        </nav>
        <div className="sidebar-bottom">
          <div className="sidebar-tip">
            <span className="tip-icon"><Sparkles size={15} /></span>
            <p>Your next opportunity starts with one thoughtful follow-up.</p>
            <a href="#applications">Review your pipeline <ArrowUpRight size={13} /></a>
          </div>
          <div className="profile-row">
            <span className="avatar">{user ? getInitials(user.full_name) : '·'}</span>
            <span>
              <strong>{user?.full_name ?? 'Guest workspace'}</strong>
              <small>{user?.role === 'employer' ? 'Employer workspace' : user?.role === 'recruiter' ? 'Recruiter workspace' : user?.email ?? 'Sign in to see your applications'}</small>
            </span>
          </div>
        </div>
      </aside>

      <main className="main-content" id="overview">
        <header className="topbar">
          <div className="breadcrumbs">
            <button
              type="button"
              onClick={() => { setShowProfile(false); setShowResume(false); setShowEmployer(false); setShowAppProfile(false); setActiveSection('overview') }}
              style={{ padding: 0, border: 0, color: 'inherit', background: 'transparent', font: 'inherit', cursor: 'pointer' }}
            >
              Workspace
            </button>
            <span>/</span>
            <strong>
              {showAppProfile ? 'Application Profile & Auto-Apply' : showProfile ? 'Profile' : showResume ? 'Resume' : showEmployer ? 'Company Profile' : activeSection === 'applications' ? 'Applications' : 'Overview'}
            </strong>
          </div>
          <div className="topbar-actions">
            <span className="today-label">{todayLabel}</span>
            <button className="icon-button" type="button" title="Notifications" aria-label="Notifications"><Bell size={17} /></button>
            {authChecking ? <span className="auth-checking">Checking session</span> : user ? (
              <div className="auth-account">
                <span className="top-avatar">{getInitials(user.full_name)}</span>
                <span className="auth-account-name">{user.full_name}</span>
                {(user.role === 'employer' || user.role === 'recruiter') && (
                  <button className="profile-header-button" type="button" onClick={() => { setShowProfile(false); setShowResume(false); setShowAppProfile(false); setShowEmployer(true) }} aria-label="Open company profile">
                    <Building2 size={15} /><span>Company</span>
                  </button>
                )}
                <button className="profile-header-button" type="button" onClick={() => { setShowProfile(false); setShowResume(false); setShowEmployer(false); setShowAppProfile(true) }} aria-label="Open application profile"><SlidersHorizontal size={15} /><span>Auto-Apply & Profile</span></button>
                <button className="profile-header-button" type="button" onClick={() => { setShowProfile(false); setShowEmployer(false); setShowAppProfile(false); setShowResume(true) }} aria-label="Open resume"><FileText size={15} /><span>Resume</span></button>
                <button className="profile-header-button" type="button" onClick={() => { setShowResume(false); setShowEmployer(false); setShowAppProfile(false); setShowProfile(true) }} aria-label="Open profile"><UserRound size={15} /><span>Profile</span></button>
                <button className="logout-button" type="button" onClick={logout} disabled={logoutBusy}>
                  {logoutBusy ? <LoaderCircle className="spin" size={15} /> : <LogOut size={15} />}
                  <span>{logoutBusy ? 'Signing out' : 'Sign out'}</span>
                </button>
              </div>
            ) : (
              <button className="login-button" type="button" onClick={openAuth}>
                <Mail size={15} /> <span className="login-long">Login / Get started</span><span className="login-short">Get started</span>
              </button>
            )}
          </div>
        </header>

        <div className="page-content">
          {showAppProfile && user ? (
            <ApplicationProfileSection
              user={user}
              onBack={() => setShowAppProfile(false)}
              onOpenResume={() => { setShowAppProfile(false); setShowResume(true) }}
            />
          ) : showProfile && user ? (
            <ProfileSection
              user={user}
              onUserUpdated={setUser}
              onBack={() => setShowProfile(false)}
              onOpenEmployer={() => { setShowProfile(false); setShowResume(false); setShowAppProfile(false); setShowEmployer(true) }}
            />
          ) : showResume && user ? (
            <ResumeSection onBack={() => setShowResume(false)} />
          ) : showEmployer && user ? (
            <EmployerProfileSection
              user={user}
              onUserUpdated={setUser}
              onBack={() => setShowEmployer(false)}
            />
          ) : <>
          <section className="welcome-row">
            <div>
              <div className="eyebrow"><span className="eyebrow-dot" /> YOUR CAREER, IN MOTION</div>
              <h1>Good morning.</h1>
              <p className="welcome-subtitle">A clear view of where you are and what comes next.</p>
            </div>
            <button className="primary-button" onClick={openApplicationForm} type="button" disabled={authChecking}><Plus size={17} /> Add application</button>
          </section>

          <section className="stats-grid" aria-label="Application summary">
            <article className="stat-card stat-featured">
              <div className="stat-top"><span>In your pipeline</span><span className="stat-symbol"><BriefcaseBusiness size={16} /></span></div>
              <div className="stat-value">{activeCount}<span className="stat-unit"> applications</span></div>
              <div className="stat-foot"><span className="status-pip" /> Keep your momentum going</div>
            </article>
            <article className="stat-card">
              <div className="stat-top"><span>Interviews</span><span className="stat-symbol symbol-coral"><Clock3 size={16} /></span></div>
              <div className="stat-value">{interviewCount}</div><div className="stat-foot">In progress right now</div>
            </article>
            <article className="stat-card">
              <div className="stat-top"><span>Offers</span><span className="stat-symbol symbol-gold"><Check size={16} /></span></div>
              <div className="stat-value">{offerCount}</div><div className="stat-foot">The work is adding up</div>
            </article>
          </section>

          <section className="pipeline-section" aria-labelledby="discovery-title">
            <div className="section-heading">
              <div><div className="section-kicker">OPEN ROLES</div><h2 id="discovery-title">Job discovery</h2></div>
              <button className="text-button" type="button" onClick={() => user ? setShowPreferences(true) : openAuth()}><Pencil size={14} /> Preferences</button>
            </div>
            <div className="table-toolbar">
              <div className="filter-tabs" role="group" aria-label="Sort discovery jobs">
                {['Best Match', 'Latest Posted'].map((item) => (
                  <button key={item} className={discoverySort === item ? 'filter-tab selected' : 'filter-tab'} onClick={() => setDiscoverySort(item)} type="button">{item}</button>
                ))}
              </div>
              <label className="search-field discovery-search-field">
                <Search size={15} />
                <input
                  value={discoverySearch}
                  onChange={(event) => setDiscoverySearch(event.target.value)}
                  placeholder="Search jobs, companies, locations..."
                  aria-label="Search open jobs"
                />
                {discoverySearch && (
                  <button
                    className="clear-filter-btn"
                    type="button"
                    onClick={() => setDiscoverySearch('')}
                    aria-label="Clear keyword search"
                  >
                    ×
                  </button>
                )}
              </label>
            </div>
            <div className="discovery-filter-bar">
              <div className="discovery-filter-group">
                <label className="filter-select-label">
                  <span>Source</span>
                  <select value={sourceFilter} onChange={(e) => { setSourceFilter(e.target.value); setDiscoveryPage(1); }} aria-label="Filter by job source">
                    <option value="all">All Sources</option>
                    <option value="internal">CareerStudio</option>
                    <option value="adzuna">Adzuna</option>
                    <option value="jooble">Jooble</option>
                  </select>
                </label>
                <label className="filter-select-label">
                  <span>Work Mode</span>
                  <select value={workModeFilter} onChange={(e) => { setWorkModeFilter(e.target.value); setDiscoveryPage(1); }} aria-label="Filter by work mode">
                    <option value="Any">Any Work Mode</option>
                    <option value="Remote">Remote</option>
                    <option value="Hybrid">Hybrid</option>
                    <option value="Onsite">Onsite</option>
                  </select>
                </label>
                <label className="filter-select-label">
                  <span>Employment</span>
                  <select value={employmentTypeFilter} onChange={(e) => { setEmploymentTypeFilter(e.target.value); setDiscoveryPage(1); }} aria-label="Filter by employment type">
                    <option value="Any">Any Employment</option>
                    <option value="Full-time">Full-time</option>
                    <option value="Part-time">Part-time</option>
                    <option value="Contract">Contract</option>
                    <option value="Internship">Internship</option>
                  </select>
                </label>
                <label className="filter-location-field">
                  <MapPin size={13} />
                  <input
                    value={locationFilter}
                    onChange={(e) => { setLocationFilter(e.target.value); setDiscoveryPage(1); }}
                    placeholder="Filter by location"
                    aria-label="Filter by location"
                  />
                  {locationFilter && (
                    <button className="clear-filter-btn" type="button" onClick={() => { setLocationFilter(''); setDiscoveryPage(1); }} aria-label="Clear location filter">×</button>
                  )}
                </label>
                <label className="filter-salary-field">
                  <Banknote size={13} />
                  <input
                    type="number"
                    min="0"
                    step="1000"
                    value={minSalaryFilter}
                    onChange={(e) => { setMinSalaryFilter(e.target.value); setDiscoveryPage(1); }}
                    placeholder="Min salary"
                    aria-label="Filter by minimum salary"
                  />
                  {minSalaryFilter && (
                    <button className="clear-filter-btn" type="button" onClick={() => { setMinSalaryFilter(''); setDiscoveryPage(1); }} aria-label="Clear minimum salary filter">×</button>
                  )}
                </label>
              </div>
              {(discoverySearch.trim() || sourceFilter !== 'all' || workModeFilter !== 'Any' || employmentTypeFilter !== 'Any' || locationFilter.trim() || minSalaryFilter.trim()) && (
                <button
                  className="reset-filters-btn"
                  type="button"
                  onClick={() => {
                    setDiscoverySearch('')
                    setSourceFilter('all')
                    setWorkModeFilter('Any')
                    setEmploymentTypeFilter('Any')
                    setLocationFilter('')
                    setMinSalaryFilter('')
                    setDiscoveryPage(1)
                  }}
                >
                  Reset filters
                </button>
              )}
            </div>
            {discoveryError && <div className="notice" role="status"><CircleHelp size={16} /> {discoveryError}</div>}
            <div className="table-scroll"><table className="applications-table">
              <thead><tr><th>ROLE</th><th>COMPANY</th><th>SOURCE</th><th>LOCATION</th><th>WORK TYPE</th><th>SALARY</th><th>POSTED</th><th>MATCH</th><th>DETAILS</th></tr></thead>
              <tbody>
                {discoveryLoading && <tr><td className="table-message" colSpan="9">Loading unified jobs...</td></tr>}
                {!discoveryLoading && discoveryJobs.map((job) => (
                  <tr key={job.id}>
                    <td><strong>{job.title}</strong></td>
                    <td>{job.company}</td>
                    <td>
                      <span className={`source-badge source-${job.source || (job.is_external ? 'external' : 'internal')}`}>
                        {job.source === 'adzuna' ? 'Adzuna' : job.source === 'arbeitnow' ? 'Arbeitnow' : job.source === 'jooble' ? 'Jooble' : 'CareerStudio'}
                      </span>
                    </td>
                    <td>{job.location || 'Not specified'}</td>
                    <td>{job.remote_type || 'Not specified'}</td>
                    <td>{formatSalary(job.salary_min, job.salary_max, job.currency) || 'Not listed'}</td>
                    <td>{job.posted_at ? formatDate(job.posted_at) : 'Not listed'}</td>
                    <td>{typeof job.match_score === 'number' ? `${job.match_score}%` : discoveryMatches[job.id] ? `${discoveryMatches[job.id].score}%` : '—'}</td>
                    <td><button className="text-button" type="button" onClick={() => { setDiscoverySaveError(''); setMatchStatusFeedback({ error: '', success: '' }); setApplyFeedback({ status: '', message: '' }); setSelectedDiscoveryJob(job) }}>View</button></td>
                  </tr>
                ))}
                {!discoveryLoading && !discoveryError && discoveryJobs.length === 0 && (
                  <tr><td className="empty-cell" colSpan="9"><div className="empty-state"><span className="empty-icon"><BriefcaseBusiness size={18} /></span><strong>No jobs found</strong><span>Try adjusting your search keywords, source, or filter criteria.</span></div></td></tr>
                )}
              </tbody>
            </table></div>
            <div className="discovery-pagination-bar">
              <span className="pagination-info">
                Showing page {discoveryPage} of {discoveryTotalPages} ({discoveryTotalResults} total jobs)
              </span>
              <div className="pagination-controls">
                <button
                  className="secondary-button small-button"
                  type="button"
                  disabled={discoveryPage <= 1 || discoveryLoading}
                  onClick={() => setDiscoveryPage((p) => Math.max(1, p - 1))}
                >
                  Previous
                </button>
                <button
                  className="secondary-button small-button"
                  type="button"
                  disabled={discoveryPage >= discoveryTotalPages || discoveryLoading}
                  onClick={() => setDiscoveryPage((p) => p + 1)}
                >
                  Next
                </button>
              </div>
            </div>

          </section>

          <section className="pipeline-section" id="applications">
            <div className="section-heading">
              <div><div className="section-kicker">KEEP THE THREAD</div><h2>Application pipeline</h2></div>
              <button className="text-button" type="button" onClick={openApplicationForm} disabled={authChecking}><Plus size={15} /> New application</button>
            </div>
            <div className="table-toolbar">
              <div className="filter-tabs" role="group" aria-label="Filter applications">
                {['All applications', 'Saved', 'Applied', 'Interview', 'Offer', 'Rejected'].map((item) => {
                  const count = item === 'All applications' ? jobs.length : jobs.filter((j) => j.status === item).length
                  return (
                    <button
                      key={item}
                      className={filter === item ? 'filter-tab selected' : 'filter-tab'}
                      onClick={() => setFilter(item)}
                      type="button"
                    >
                      {item}
                      <span className="tab-count">{count}</span>
                    </button>
                  )
                })}
              </div>
              <label className="search-field"><Search size={15} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search roles, companies..." aria-label="Search applications" /></label>
            </div>

            {error && <div className="notice" role="status"><CircleHelp size={16} /> {error}<button type="button" onClick={loadApplications}>Retry</button></div>}
            <div className="table-scroll"><table className="applications-table pipeline-table">
              <thead><tr><th>ROLE & COMPANY</th><th>LOCATION</th><th>DATE APPLIED</th><th>STAGE</th><th>LINK</th></tr></thead>
              <tbody>
                {loading && <tr><td className="table-message" colSpan="5">Loading your applications...</td></tr>}
                {!loading && visibleJobs.map((job) => (
                  <tr
                    key={job.id}
                    className="pipeline-row"
                    tabIndex={0}
                    onClick={() => {
                      setApplicationModalFeedback({ error: '', success: '' })
                      setSelectedApplication(job)
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault()
                        setApplicationModalFeedback({ error: '', success: '' })
                        setSelectedApplication(job)
                      }
                    }}
                    title="Click to view application details"
                  >
                    <td>
                      <div className="company-cell">
                        <span className={`company-mark tone-${(job.company || 'J').charCodeAt(0) % 5}`}>
                          {(job.company || 'J').slice(0, 1).toUpperCase()}
                        </span>
                        <span>
                          <strong>{job.role}</strong>
                          <small>{job.company}</small>
                        </span>
                      </div>
                    </td>
                    <td>{job.location || '—'}</td>
                    <td className="date-cell">{job.applied_at ? formatDate(job.applied_at) : '—'}</td>
                    <td>
                      <label
                        className={`stage-select stage-${(job.status || 'saved').toLowerCase()}`}
                        onClick={(e) => e.stopPropagation()}
                        onKeyDown={(e) => e.stopPropagation()}
                      >
                        <span>{job.status}</span>
                        <ChevronDown size={13} />
                        <select
                          aria-label={`Change stage for ${job.role} at ${job.company}`}
                          value={job.status}
                          onClick={(e) => e.stopPropagation()}
                          onKeyDown={(e) => e.stopPropagation()}
                          onChange={(event) => updateStage(job.id, event.target.value)}
                        >
                          {stages.map((stage) => <option key={stage} value={stage}>{stage}</option>)}
                        </select>
                      </label>
                    </td>
                    <td>
                      {job.source_url ? (
                        <a
                          className="external-link"
                          href={job.source_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={(e) => e.stopPropagation()}
                          onKeyDown={(e) => e.stopPropagation()}
                          aria-label={`Open external listing for ${job.role} at ${job.company} (opens in new tab)`}
                        >
                          <ExternalLink size={15} />
                        </a>
                      ) : (
                        <span className="no-link">—</span>
                      )}
                    </td>
                  </tr>
                ))}
                {!loading && visibleJobs.length === 0 && (
                  <tr>
                    <td className="empty-cell" colSpan="5">
                      <div className="empty-state">
                        <span className="empty-icon"><BriefcaseBusiness size={18} /></span>
                        <strong>{jobs.length ? 'No applications match your filter' : user ? 'Your application pipeline is empty' : 'Sign in to view your applications'}</strong>
                        <span>{jobs.length ? 'Try selecting another stage or clearing your search.' : user ? 'Track applications directly from Job Discovery or add one manually.' : 'Keep track of all your active job applications in one place.'}</span>
                        {!jobs.length && user && (
                          <button className="primary-button small-button" onClick={openApplicationForm} type="button">
                            <Plus size={15} /> Add an application
                          </button>
                        )}
                        {!user && (
                          <button className="primary-button small-button" onClick={openAuth} type="button">
                            Sign in to workspace
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                )}
              </tbody>
            </table></div>
            <div className="table-footer"><span>Showing {visibleJobs.length} of {jobs.length} applications</span><a href="#overview">Back to overview <ArrowUpRight size={13} /></a></div>
          </section>
          <footer className="page-footer"><span>One step at a time.</span><span>Built for your next move</span></footer>
          </>}
        </div>
      </main>

      {showForm && <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setShowForm(false) }}>
        <section className="application-modal" role="dialog" aria-modal="true" aria-labelledby="modal-title">
          <div className="modal-heading"><div><div className="section-kicker">A GOOD NEXT STEP</div><h2 id="modal-title">Add an application</h2></div><button className="close-button" type="button" onClick={() => setShowForm(false)} aria-label="Close form">×</button></div>
          <form onSubmit={addApplication} className="application-form">
            <label>Company<input name="company" placeholder="e.g. Northstar Studio" required maxLength="120" /></label>
            <label>Role<input name="role" placeholder="e.g. Product Designer" required maxLength="160" /></label>
            <label>Location <span>Optional</span><input name="location" placeholder="Remote, New York..." maxLength="120" /></label>
            <label>Job listing URL <span>Optional</span><input name="source_url" type="url" placeholder="https://" maxLength="2048" /></label>
            <label>Stage<select name="status" defaultValue="Saved">{stages.map((stage) => <option key={stage}>{stage}</option>)}</select></label>
            <div className="form-actions"><button className="secondary-button" type="button" onClick={() => setShowForm(false)}>Cancel</button><button className="primary-button" type="submit" disabled={saving}>{saving ? 'Saving...' : <><Plus size={16} /> Save application</>}</button></div>
          </form>
        </section>
      </div>}

      {selectedDiscoveryJob && <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !discoverySaving) setSelectedDiscoveryJob(null) }}>
        <section className="application-modal job-details-modal" role="dialog" aria-modal="true" aria-labelledby="job-details-title">
          <div className="modal-heading">
            <div>
              <div className="section-kicker">JOB DETAILS</div>
              <h2 id="job-details-title">{selectedDiscoveryJob.title}</h2>
              <div className="job-details-subtitle">
                <span className="job-details-company">{selectedDiscoveryJob.company}</span>
                {selectedDiscoveryJob.location && (
                  <>
                    <span className="job-details-dot">·</span>
                    <span>{selectedDiscoveryJob.location}</span>
                  </>
                )}
              </div>
            </div>
            <button className="close-button" type="button" onClick={() => setSelectedDiscoveryJob(null)} disabled={discoverySaving} aria-label="Close job details">×</button>
          </div>

          <div className="job-details-body">
            <div className="job-source-banner">
              <span className={`source-badge source-${selectedDiscoveryJob.source || (selectedDiscoveryJob.is_external ? 'external' : 'internal')}`}>
                {selectedDiscoveryJob.source === 'adzuna' ? 'Adzuna' : selectedDiscoveryJob.source === 'arbeitnow' ? 'Arbeitnow' : selectedDiscoveryJob.source === 'jooble' ? 'Jooble' : 'CareerStudio'}
              </span>
              <span className="source-attribution-text">
                {selectedDiscoveryJob.attribution || (selectedDiscoveryJob.is_external ? 'External Aggregated Listing' : 'CareerStudio Recruiter Verified')}
              </span>
            </div>

            <div className="job-details-grid">
              <div className="job-details-stat">
                <span className="job-stat-label">Location</span>
                <strong className="job-stat-val">{selectedDiscoveryJob.location || 'Not specified'}</strong>
              </div>
              <div className="job-details-stat">
                <span className="job-stat-label">Work Mode</span>
                <strong className="job-stat-val">{formatWorkMode(selectedDiscoveryJob.remote_type)}</strong>
              </div>
              <div className="job-details-stat">
                <span className="job-stat-label">Employment</span>
                <strong className="job-stat-val">{formatEmploymentType(selectedDiscoveryJob.employment_type)}</strong>
              </div>
              <div className="job-details-stat">
                <span className="job-stat-label">Industry</span>
                <strong className="job-stat-val">{selectedDiscoveryJob.industry || 'Not specified'}</strong>
              </div>
              <div className="job-details-stat">
                <span className="job-stat-label">Salary</span>
                <strong className="job-stat-val">{formatSalary(selectedDiscoveryJob.salary_min, selectedDiscoveryJob.salary_max, selectedDiscoveryJob.currency) || 'Not listed'}</strong>
              </div>
              <div className="job-details-stat">
                <span className="job-stat-label">Posted</span>
                <strong className="job-stat-val">{selectedDiscoveryJob.posted_at ? formatDate(selectedDiscoveryJob.posted_at) : 'Not listed'}</strong>
              </div>
            </div>

            {(() => {
              const jobMatch = discoveryMatches[selectedDiscoveryJob.id] || (typeof selectedDiscoveryJob.match_score === 'number' ? {
                id: selectedDiscoveryJob.id,
                job_id: selectedDiscoveryJob.id,
                score: selectedDiscoveryJob.match_score,
                score_breakdown: selectedDiscoveryJob.match_breakdown,
                status: 'new',
              } : null)

              if (!jobMatch) return null

              return (
                <div className="match-explanation-card">
                  <div className="match-explanation-header">
                    <div>
                      <div className="section-kicker">MATCH EXPLANATION</div>
                      <strong className="match-overall-title">Overall Match Score</strong>
                    </div>
                    <span className="match-overall-badge">{jobMatch.score}%</span>
                  </div>
                  <div className="match-breakdown-list">
                    {[
                      { label: 'Role match', score: jobMatch.score_breakdown?.role },
                      { label: 'Location match', score: jobMatch.score_breakdown?.location },
                      { label: 'Remote / work-mode match', score: jobMatch.score_breakdown?.remote_type },
                      { label: 'Salary match', score: jobMatch.score_breakdown?.salary },
                      { label: 'Employment type match', score: jobMatch.score_breakdown?.employment_type },
                      { label: 'Industry match', score: jobMatch.score_breakdown?.industry },
                    ].map(({ label, score }) => (
                      <div key={label} className="match-breakdown-item">
                        <div className="match-breakdown-row">
                          <span>{label}</span>
                          <strong>{typeof score === 'number' ? `${score}%` : '—'}</strong>
                        </div>
                        {typeof score === 'number' && (
                          <div className="match-breakdown-track">
                            <span style={{ width: `${Math.max(0, Math.min(100, score))}%` }} />
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                  {user && discoveryMatches[selectedDiscoveryJob.id] && (
                    <div className="match-actions-row">
                      <span className="match-status-label">
                        Status: <strong>{discoveryMatches[selectedDiscoveryJob.id].status || 'new'}</strong>
                      </span>
                      <div className="match-action-buttons">
                        {discoveryMatches[selectedDiscoveryJob.id].status !== 'saved' && (
                          <button
                            className="secondary-button match-action-btn"
                            type="button"
                            onClick={() => updateMatchStatus(discoveryMatches[selectedDiscoveryJob.id].id, 'saved')}
                            disabled={matchStatusUpdating}
                          >
                            {matchStatusUpdating ? <LoaderCircle className="spin" size={13} /> : <Bookmark size={13} />}
                            <span>Save Match</span>
                          </button>
                        )}
                        {discoveryMatches[selectedDiscoveryJob.id].status === 'saved' && (
                          <span className="match-status-badge saved">
                            <Check size={12} /> Saved Match
                          </span>
                        )}
                        {discoveryMatches[selectedDiscoveryJob.id].status !== 'dismissed' && (
                          <button
                            className="secondary-button match-action-btn dismiss"
                            type="button"
                            onClick={() => updateMatchStatus(discoveryMatches[selectedDiscoveryJob.id].id, 'dismissed')}
                            disabled={matchStatusUpdating}
                          >
                            {matchStatusUpdating ? <LoaderCircle className="spin" size={13} /> : <XCircle size={13} />}
                            <span>Dismiss Match</span>
                          </button>
                        )}
                        {discoveryMatches[selectedDiscoveryJob.id].status === 'dismissed' && (
                          <span className="match-status-badge dismissed">
                            <XCircle size={12} /> Dismissed
                          </span>
                        )}
                      </div>
                    </div>
                  )}
                  {matchStatusFeedback.error && <p className="match-feedback error" role="alert">{matchStatusFeedback.error}</p>}
                  {matchStatusFeedback.success && <p className="match-feedback success" role="status">{matchStatusFeedback.success}</p>}

                  {user && (
                    <div className="ai-explanation-container">
                      <div className="rag-question-section">
                        <div className="rag-section-header">
                          <div className="rag-section-title">
                            <Sparkles size={14} className="ai-sparkle-icon" />
                            <span>Ask Local AI (RAG) About This Match</span>
                          </div>
                          <span className="rag-privacy-badge">100% Local • Zero Cloud Cost</span>
                        </div>
                        
                        <div className="rag-preset-chips" role="group" aria-label="Preset questions">
                          {PRESET_RAG_QUESTIONS.map((q) => (
                            <button
                              key={q}
                              type="button"
                              className={`rag-chip ${selectedRagQuestion === q ? 'active' : ''}`}
                              onClick={() => setSelectedRagQuestion(q)}
                              disabled={ragAnalysisLoading}
                            >
                              {q}
                            </button>
                          ))}
                        </div>

                        <div className="rag-actions-row">
                          <button
                            type="button"
                            className="secondary-button ai-explain-btn rag-submit-btn"
                            onClick={() => askRagMatch(selectedDiscoveryJob.id, selectedRagQuestion)}
                            disabled={ragAnalysisLoading}
                          >
                            {ragAnalysisLoading ? (
                              <>
                                <LoaderCircle className="spin" size={13} />
                                <span>Retrieving profile & generating local RAG analysis...</span>
                              </>
                            ) : (
                              <>
                                <Sparkles size={13} className="ai-sparkle-icon" />
                                <span>Analyze Match with Local RAG</span>
                              </>
                            )}
                          </button>
                        </div>
                      </div>

                      {ragAnalysisError && (
                        <div className="ai-explanation-error" role="alert">
                          <CircleHelp size={13} />
                          <span>{ragAnalysisError}</span>
                        </div>
                      )}

                      {ragAnalyses?.[selectedDiscoveryJob.id] && (() => {
                        const rag = ragAnalyses[selectedDiscoveryJob.id]
                        const isExpanded = !!expandedEvidence[selectedDiscoveryJob.id]
                        return (
                          <div className="ai-explanation-card rag-card">
                            <div className="ai-explanation-header">
                              <div className="ai-explanation-title">
                                <Sparkles size={14} className="ai-sparkle-icon" />
                                <strong>Grounded Match Analysis</strong>
                              </div>
                              <div className="ai-badges-container">
                                <span className="ai-model-badge">
                                  LLM: {rag.model || 'qwen2.5:1.5b'}
                                </span>
                                <span className="ai-embed-badge">
                                  Embeddings: {rag.embedding_model || 'all-minilm'}
                                </span>
                              </div>
                            </div>

                            <div className="rag-authoritative-box">
                              <span className="authoritative-tag">Authoritative Deterministic Match</span>
                              <span className="authoritative-value">
                                {rag.deterministic_score ?? discoveryMatches[selectedDiscoveryJob.id]?.score ?? 0}%
                              </span>
                            </div>

                            {rag.question && (
                              <div className="rag-queried-box">
                                <span className="rag-queried-kicker">Question:</span>
                                <span className="rag-queried-text">{rag.question}</span>
                              </div>
                            )}

                            <p className="ai-explanation-summary">
                              {rag.explanation?.summary}
                            </p>

                            {rag.explanation?.strong_matches?.length > 0 && (
                              <div className="ai-explanation-group">
                                <span className="ai-group-kicker success">Strong Alignment</span>
                                <ul className="ai-bullet-list">
                                  {rag.explanation.strong_matches.map((item, idx) => (
                                    <li key={idx}><Check size={12} className="ai-check-icon" /> <span>{item}</span></li>
                                  ))}
                                </ul>
                              </div>
                            )}

                            {rag.explanation?.potential_gaps?.length > 0 && (
                              <div className="ai-explanation-group">
                                <span className="ai-group-kicker warning">Potential Gaps / Unverified</span>
                                <ul className="ai-bullet-list">
                                  {rag.explanation.potential_gaps.map((item, idx) => (
                                    <li key={idx}><span className="ai-gap-bullet" /> <span>{item}</span></li>
                                  ))}
                                </ul>
                              </div>
                            )}

                            {rag.explanation?.suggestions?.length > 0 && (
                              <div className="ai-explanation-group">
                                <span className="ai-group-kicker info">Application Suggestions</span>
                                <ul className="ai-bullet-list">
                                  {rag.explanation.suggestions.map((item, idx) => (
                                    <li key={idx}><Sparkles size={11} className="ai-tip-icon" /> <span>{item}</span></li>
                                  ))}
                                </ul>
                              </div>
                            )}

                            {rag.evidence && rag.evidence.length > 0 && (
                              <div className="rag-evidence-wrapper">
                                <button
                                  type="button"
                                  className="rag-evidence-toggle-btn"
                                  onClick={() => setExpandedEvidence((prev) => ({
                                    ...prev,
                                    [selectedDiscoveryJob.id]: !prev[selectedDiscoveryJob.id],
                                  }))}
                                >
                                  <span>Retrieved Evidence & Citations ({rag.evidence.length})</span>
                                  <ChevronDown
                                    size={14}
                                    className={`rag-chevron ${isExpanded ? 'rotated' : ''}`}
                                  />
                                </button>
                                {isExpanded && (
                                  <div className="rag-evidence-list">
                                    {rag.evidence.map((ev, idx) => (
                                      <div key={idx} className="rag-evidence-card">
                                        <div className="rag-evidence-card-header">
                                          <span className={`rag-source-pill ${ev.source_type || 'resume'}`}>
                                            {ev.source_type === 'resume'
                                              ? 'Resume'
                                              : ev.source_type === 'application_profile'
                                                ? 'Application Profile'
                                                : 'Job Posting'}
                                          </span>
                                          {ev.section && <span className="rag-section-pill">{ev.section}</span>}
                                          {ev.similarity !== undefined && (
                                            <span className="rag-sim-pill">
                                              Similarity: {Math.round(ev.similarity * 100)}%
                                            </span>
                                          )}
                                        </div>
                                        <blockquote className="rag-evidence-content">
                                          "{ev.content}"
                                        </blockquote>
                                      </div>
                                    ))}
                                  </div>
                                )}
                              </div>
                            )}

                            <div className="ai-disclaimer">
                              Local RAG analysis strictly grounded on retrieved profile & job embeddings. Deterministic match percentage remains 100% authoritative and invariant.
                            </div>
                          </div>
                        )
                      })()}
                    </div>
                  )}
                </div>
              )
            })()}

            <div className="job-details-section">
              <div className="section-kicker">DESCRIPTION</div>
              <p className="job-details-description">{selectedDiscoveryJob.description || 'No description provided.'}</p>
            </div>

            {(selectedDiscoveryJob.apply_url || selectedDiscoveryJob.source_url) && (
              <div className="job-details-section">
                <div className="section-kicker">SOURCE & APPLICATION LINK</div>
                <div className="job-apply-row">
                  <a
                    className="job-external-link"
                    href={selectedDiscoveryJob.apply_url || selectedDiscoveryJob.source_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={() => handleApplyExternalClick(selectedDiscoveryJob)}
                    aria-label={`Open original job listing for ${selectedDiscoveryJob.title} at ${selectedDiscoveryJob.company} (opens in new tab)`}
                  >
                    <span>
                      {selectedDiscoveryJob.is_external
                        ? `Apply on ${selectedDiscoveryJob.source === 'adzuna' ? 'Adzuna' : selectedDiscoveryJob.source === 'arbeitnow' ? 'Arbeitnow' : selectedDiscoveryJob.source === 'jooble' ? 'Jooble' : 'External Site'}`
                        : 'Apply / Open original job posting'}
                    </span>
                    <ExternalLink size={13} aria-hidden="true" />
                    <span className="external-link-hint">(opens in new tab)</span>
                  </a>
                  {jobs.some((j) => j.job_id === selectedDiscoveryJob.id) && (
                    <span className="job-tracked-badge">
                      <Check size={12} /> Tracked in pipeline
                    </span>
                  )}
                </div>
                {applyFeedback.message && (
                  <p className={`apply-feedback ${applyFeedback.status}`} role={applyFeedback.status === 'error' ? 'alert' : 'status'}>
                    {applyFeedback.message}
                  </p>
                )}
              </div>
            )}

            {discoverySaveError && <div className="notice" role="alert"><CircleHelp size={16} /> {discoverySaveError}</div>}

            <div className="form-actions">
              <button
                className="secondary-button kitty-modal-trigger-btn"
                type="button"
                onClick={() => openKittyWithJob(selectedDiscoveryJob)}
                title="Chat with Kitty about this job"
              >
                <Sparkles size={14} /> Ask Kitty
              </button>
              <button className="secondary-button" type="button" onClick={() => setSelectedDiscoveryJob(null)} disabled={discoverySaving}>Close</button>
              {selectedDiscoveryJob.is_external ? (
                <a
                  className="primary-button"
                  href={selectedDiscoveryJob.apply_url || selectedDiscoveryJob.source_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={() => handleApplyExternalClick(selectedDiscoveryJob)}
                  style={{ textDecoration: 'none' }}
                >
                  <ExternalLink size={16} /> Apply on {selectedDiscoveryJob.source === 'adzuna' ? 'Adzuna' : selectedDiscoveryJob.source === 'arbeitnow' ? 'Arbeitnow' : selectedDiscoveryJob.source === 'jooble' ? 'Jooble' : 'External Board'}
                </a>
              ) : (
                <button className="primary-button" type="button" onClick={saveDiscoveredJob} disabled={discoverySaving || jobs.some((job) => job.job_id === selectedDiscoveryJob.id)}>
                  {jobs.some((job) => job.job_id === selectedDiscoveryJob.id) ? <><Check size={16} /> Saved</> : discoverySaving ? <><LoaderCircle className="spin" size={16} /> Saving</> : <><Plus size={16} /> Save Job</>}
                </button>
              )}
            </div>
          </div>

        </section>
      </div>}


      {selectedApplication && <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !applicationUpdating) setSelectedApplication(null) }}>
        <section className="application-modal job-details-modal" role="dialog" aria-modal="true" aria-labelledby="app-details-title">
          <div className="modal-heading">
            <div>
              <div className="section-kicker">APPLICATION DETAILS</div>
              <h2 id="app-details-title">{selectedApplication.role}</h2>
              <div className="job-details-subtitle">
                <span className="job-details-company">{selectedApplication.company}</span>
                {selectedApplication.location && (
                  <>
                    <span className="job-details-dot">·</span>
                    <span>{selectedApplication.location}</span>
                  </>
                )}
              </div>
            </div>
            <button className="close-button" type="button" onClick={() => setSelectedApplication(null)} disabled={applicationUpdating} aria-label="Close application details">×</button>
          </div>

          <div className="job-details-body">
            <div className="job-details-grid">
              <div className="job-details-stat">
                <span className="job-stat-label">Company</span>
                <strong className="job-stat-val">{selectedApplication.company}</strong>
              </div>
              <div className="job-details-stat">
                <span className="job-stat-label">Role</span>
                <strong className="job-stat-val">{selectedApplication.role}</strong>
              </div>
              <div className="job-details-stat">
                <span className="job-stat-label">Location</span>
                <strong className="job-stat-val">{selectedApplication.location || 'Not specified'}</strong>
              </div>
              <div className="job-details-stat">
                <span className="job-stat-label">Current Stage</span>
                <strong className="job-stat-val">
                  <span className={`stage-select stage-${(selectedApplication.status || 'saved').toLowerCase()}`} style={{ cursor: 'default' }}>
                    {selectedApplication.status}
                  </span>
                </strong>
              </div>
              <div className="job-details-stat">
                <span className="job-stat-label">Date Applied</span>
                <strong className="job-stat-val">{selectedApplication.applied_at ? formatDate(selectedApplication.applied_at) : '—'}</strong>
              </div>
              <div className="job-details-stat">
                <span className="job-stat-label">Application ID</span>
                <strong className="job-stat-val" style={{ fontSize: '9px', fontFamily: 'monospace' }}>{selectedApplication.id.slice(0, 8)}...</strong>
              </div>
            </div>

            <div className="job-details-section">
              <div className="section-kicker">UPDATE STATUS</div>
              <div className="app-stage-actions">
                {stages.map((stage) => (
                  <button
                    key={stage}
                    type="button"
                    className={`app-stage-btn stage-${stage.toLowerCase()} ${selectedApplication.status === stage ? 'active' : ''}`}
                    onClick={() => updateModalApplicationStage(stage)}
                    disabled={applicationUpdating || selectedApplication.status === stage}
                  >
                    {selectedApplication.status === stage && <Check size={11} />}
                    {stage}
                  </button>
                ))}
              </div>
              {applicationModalFeedback.error && <p className="match-feedback error" role="alert">{applicationModalFeedback.error}</p>}
              {applicationModalFeedback.success && <p className="match-feedback success" role="status">{applicationModalFeedback.success}</p>}
            </div>

            <div className="job-details-section">
              <div className="section-kicker">APPLICATION NOTES</div>
              <div className="app-notes-card">
                <p className="app-notes-disabled-msg">
                  Application notes are not currently supported by the database schema.
                </p>
              </div>
            </div>

            {selectedApplication.source_url && (
              <div className="job-details-section">
                <div className="section-kicker">SOURCE & APPLICATION LINK</div>
                <a
                  className="job-external-link"
                  href={selectedApplication.source_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={`Open external listing for ${selectedApplication.role} at ${selectedApplication.company} (opens in new tab)`}
                >
                  <span>Open original job posting</span>
                  <ExternalLink size={13} aria-hidden="true" />
                  <span className="external-link-hint">(opens in new tab)</span>
                </a>
              </div>
            )}

            <div className="form-actions">
              <button className="secondary-button" type="button" onClick={() => setSelectedApplication(null)} disabled={applicationUpdating}>Close</button>
            </div>
          </div>
        </section>
      </div>}

      {showPreferences && user && <JobPreferencesModal user={user} onClose={() => setShowPreferences(false)} />}

      {authOpen && <div className="modal-backdrop auth-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) closeAuth() }}>
        <section className="auth-modal" role="dialog" aria-modal="true" aria-labelledby="auth-title">
          <div className="auth-modal-top">
            <a className="brand auth-brand" href="#overview" aria-label="Career Studio">
              <span className="brand-mark"><BriefcaseBusiness size={16} /></span>
              <span>career<span className="brand-light">studio</span></span>
            </a>
            <button className="close-button" type="button" onClick={closeAuth} disabled={authBusy} aria-label="Close sign in">×</button>
          </div>

          {authStep === 'email' && <>
            <div className="auth-heading">
              <span className="auth-kicker">
                {authRoleIntent === 'recruiter' ? 'HIRE TOP TALENT' : 'YOUR CAREER, IN MOTION'}
              </span>
              <h2 id="auth-title">
                {authRoleIntent === 'recruiter' ? 'Welcome, Recruiter.' : 'A little closer to your next move.'}
              </h2>
              <p>
                {authRoleIntent === 'recruiter'
                  ? 'Sign in or create an account to post jobs and review applicants.'
                  : 'Use your email to sign in or create your job seeker workspace.'}
              </p>
            </div>

            <div className="auth-role-selection" role="radiogroup" aria-label="Select what you want to do">
              <button
                type="button"
                className={`auth-role-card ${authRoleIntent === 'job_seeker' ? 'active' : ''}`}
                onClick={() => setAuthRoleIntent('job_seeker')}
                role="radio"
                aria-checked={authRoleIntent === 'job_seeker'}
              >
                <div className="auth-role-card-top">
                  <span className="auth-role-icon"><UserRound size={16} /></span>
                  {authRoleIntent === 'job_seeker' && <span className="auth-role-check"><Check size={14} /></span>}
                </div>
                <div className="auth-role-title">I'm Seeking a Job</div>
                <div className="auth-role-desc">Discover roles & track applications</div>
              </button>

              <button
                type="button"
                className={`auth-role-card ${authRoleIntent === 'recruiter' ? 'active' : ''}`}
                onClick={() => setAuthRoleIntent('recruiter')}
                role="radio"
                aria-checked={authRoleIntent === 'recruiter'}
              >
                <div className="auth-role-card-top">
                  <span className="auth-role-icon"><Building2 size={16} /></span>
                  {authRoleIntent === 'recruiter' && <span className="auth-role-check"><Check size={14} /></span>}
                </div>
                <div className="auth-role-title">I'm a Recruiter</div>
                <div className="auth-role-desc">Post open roles & hire talent</div>
              </button>
            </div>

            <div className="auth-mode-toggle" role="tablist" aria-label="Account action">
              <button className={authMode === 'login' ? 'auth-mode active' : 'auth-mode'} type="button" role="tab" aria-selected={authMode === 'login'} onClick={() => setAuthMode('login')}>Sign in</button>
              <button className={authMode === 'signup' ? 'auth-mode active' : 'auth-mode'} type="button" role="tab" aria-selected={authMode === 'signup'} onClick={() => setAuthMode('signup')}>Create account</button>
            </div>
            <form className="auth-form" onSubmit={sendOtp}>
              {authMode === 'signup' && <label>
                Your name
                <input autoComplete="name" value={authName} onChange={(event) => setAuthName(event.target.value)} placeholder="Name you go by" required maxLength="160" />
              </label>}
              <label>
                Email address
                <input type="email" autoComplete="email" value={authEmail} onChange={(event) => setAuthEmail(event.target.value)} placeholder="you@example.com" required maxLength="254" />
              </label>
              <p className="auth-helper">We’ll send a one-time code. No password needed.</p>
              {authError && <p className="auth-error" role="alert">{authError}</p>}
              <button className="primary-button auth-submit" type="submit" disabled={authBusy}>
                {authBusy ? <><LoaderCircle className="spin" size={16} /> Sending code</> : <><Mail size={16} /> Send one-time code</>}
              </button>
            </form>
          </>}

          {authStep === 'verify' && <>
            <button className="auth-back" type="button" onClick={() => { setAuthStep('email'); setAuthError('') }} disabled={authBusy}><ArrowLeft size={15} /> Change email</button>
            <div className="auth-heading verify-heading">
              <span className="auth-icon"><Mail size={19} /></span>
              <h2 id="auth-title">Check your inbox.</h2>
              <p>Enter the six-digit code sent to <strong>{authEmail}</strong>.</p>
            </div>
            {authMessage && <p className="auth-message" role="status">{authMessage}</p>}
            <form className="auth-form" onSubmit={verifyOtp}>
              {authMode === 'signup' && <label>
                Your name
                <input autoComplete="name" value={authName} onChange={(event) => setAuthName(event.target.value)} placeholder="Name you go by" required maxLength="160" />
              </label>}
              <label>
                Verification code
                <input className="otp-input" type="text" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength="6" value={authCode} onChange={(event) => setAuthCode(event.target.value.replace(/\D/g, '').slice(0, 6))} placeholder="000000" required aria-label="Six-digit verification code" />
              </label>
              {authError && <p className="auth-error" role="alert">{authError}</p>}
              <button className="primary-button auth-submit" type="submit" disabled={authBusy || authCode.length !== 6}>
                {authBusy ? <><LoaderCircle className="spin" size={16} /> Verifying</> : <><ShieldCheck size={16} /> Verify and continue</>}
              </button>
            </form>
            <div className="resend-row">
              <span>Code expires in 10 minutes.</span>
              <button type="button" onClick={() => sendOtp()} disabled={authBusy || resendIn > 0}>
                {resendIn > 0 ? `Resend in ${resendIn}s` : 'Resend code'}
              </button>
            </div>
            {authMode === 'login' && <button className="auth-switch" type="button" onClick={() => { setAuthMode('signup'); setAuthError('') }}>New here? Create an account</button>}
          </>}

          {authStep === 'success' && <div className="auth-success">
            <span className="success-mark"><CheckCircle2 size={28} /></span>
            <span className="auth-kicker">SIGNED IN</span>
            <h2 id="auth-title">Welcome, {user?.full_name?.split(' ')[0] || 'back'}.</h2>
            <p>{authMessage}</p>
            <button className="primary-button auth-submit" type="button" onClick={closeAuth}>Continue to workspace <ArrowUpRight size={16} /></button>
          </div>}

          <div className="auth-modal-footer"><span>Career Studio</span><span>Private by design</span></div>
        </section>
      </div>}

      {/* Step 12.5 — Kitty AI Floating Launcher Button */}
      <button
        className={`kitty-floating-toggle ${kittyOpen ? 'active' : ''}`}
        type="button"
        onClick={() => setKittyOpen(!kittyOpen)}
        aria-label="Open Kitty Career AI Assistant"
        title="Kitty — Career AI Assistant"
      >
        <span className="kitty-icon-wrapper">
          <Sparkles size={16} className="kitty-sparkle-icon" />
          <span className="kitty-emoji">🐱</span>
        </span>
        <span className="kitty-toggle-label">Kitty AI</span>
        {kittyActiveJob && <span className="kitty-job-active-dot" title="Active Job Context" />}
      </button>

      {/* Step 12.5 — Kitty Career AI Assistant Drawer Panel */}
      {kittyOpen && (
        <div className="kitty-drawer-container">
          <div className="kitty-drawer-panel" role="region" aria-label="Kitty Career AI Assistant">
            <div className="kitty-drawer-header">
              <div className="kitty-header-title-row">
                <div className="kitty-avatar">🐱</div>
                <div>
                  <h3 className="kitty-title">Kitty</h3>
                  <span className="kitty-subtitle">Career AI Assistant • 100% Local</span>
                </div>
              </div>
              <div className="kitty-header-actions">
                <button
                  type="button"
                  className="kitty-header-action-btn"
                  onClick={startNewKittyChat}
                  title="New Conversation"
                  aria-label="Start new conversation"
                >
                  <RefreshCw size={14} />
                  <span>New</span>
                </button>
                <button
                  type="button"
                  className="kitty-header-action-btn close"
                  onClick={() => setKittyOpen(false)}
                  title="Close Kitty"
                  aria-label="Close Kitty"
                >
                  ✕
                </button>
              </div>
            </div>

            {kittyActiveJob && (
              <div className="kitty-job-context-bar">
                <div className="kitty-context-info">
                  <BriefcaseBusiness size={13} />
                  <span className="kitty-context-text">
                    Context: <strong>{kittyActiveJob.title}</strong> at {kittyActiveJob.company}
                  </span>
                </div>
                <button
                  type="button"
                  className="kitty-clear-context-btn"
                  onClick={() => setKittyActiveJob(null)}
                  title="Remove Job Context"
                >
                  ✕
                </button>
              </div>
            )}

            <div className="kitty-chat-messages">
              {kittyMessages.length === 0 ? (
                <div className="kitty-welcome-box">
                  <div className="kitty-welcome-emoji">🐱✨</div>
                  <h4>Hello{user?.full_name ? `, ${user.full_name.split(' ')[0]}` : ''}!</h4>
                  <p>
                    I'm <strong>Kitty</strong>, your dedicated CareerStudio assistant. Ask me anything about your resume, missing skills, matching roles, or interview preparation.
                  </p>
                  
                  <div className="kitty-prompt-chips">
                    <span className="kitty-chips-title">Suggested Prompts:</span>
                    {kittyActiveJob ? (
                      <>
                        <button
                          type="button"
                          className="kitty-chip"
                          onClick={() => sendKittyMessage('Why is this job a good match for my background?')}
                        >
                          ✨ Why is this job a good match?
                        </button>
                        <button
                          type="button"
                          className="kitty-chip"
                          onClick={() => sendKittyMessage('What skills am I missing for this role?')}
                        >
                          🎯 What skills am I missing?
                        </button>
                      </>
                    ) : (
                      <>
                        <button
                          type="button"
                          className="kitty-chip"
                          onClick={() => sendKittyMessage('What are the key strengths highlighted in my resume?')}
                        >
                          📄 Summarize my resume strengths
                        </button>
                        <button
                          type="button"
                          className="kitty-chip"
                          onClick={() => sendKittyMessage('How can I optimize my profile to attract better software engineering roles?')}
                        >
                          🚀 How can I improve my profile?
                        </button>
                        <button
                          type="button"
                          className="kitty-chip"
                          onClick={() => sendKittyMessage('What interview questions should I prepare for based on my experience?')}
                        >
                          💼 Interview preparation topics
                        </button>
                      </>
                    )}
                  </div>
                </div>
              ) : (
                kittyMessages.map((msg, index) => (
                  <div key={index} className={`kitty-msg-row ${msg.role}`}>
                    {msg.role === 'assistant' && <div className="kitty-msg-avatar">🐱</div>}
                    <div className="kitty-msg-bubble">
                      <div className="kitty-msg-text">{msg.content}</div>
                      
                      {msg.deterministic_match?.score != null && (
                        <div className="kitty-deterministic-badge">
                          <CheckCircle2 size={12} />
                          <span>Authoritative Match Score: <strong>{msg.deterministic_match.score}%</strong></span>
                        </div>
                      )}

                      {Array.isArray(msg.sources) && msg.sources.length > 0 && (
                        <div className="kitty-msg-sources">
                          <span className="kitty-sources-label">Grounded on:</span>
                          {msg.sources.map((src, sIdx) => (
                            <span key={sIdx} className={`kitty-source-pill ${src.source_type || 'resume'}`}>
                              {src.label}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                ))
              )}

              {kittyLoading && (
                <div className="kitty-msg-row assistant">
                  <div className="kitty-msg-avatar">🐱</div>
                  <div className="kitty-msg-bubble loading">
                    <LoaderCircle className="spin" size={15} />
                    <span>Kitty is thinking and retrieving context...</span>
                  </div>
                </div>
              )}

              {kittyError && (
                <div className="kitty-error-banner" role="alert">
                  <CircleHelp size={15} />
                  <span>{kittyError}</span>
                  <button
                    type="button"
                    className="kitty-retry-btn"
                    onClick={() => sendKittyMessage()}
                  >
                    Retry
                  </button>
                </div>
              )}

              <div ref={kittyMessagesEndRef} />
            </div>

            <form
              className="kitty-input-form"
              onSubmit={(e) => {
                e.preventDefault()
                sendKittyMessage()
              }}
            >
              <input
                type="text"
                className="kitty-input-field"
                placeholder={kittyActiveJob ? "Ask Kitty about this job or your fit..." : "Ask Kitty about your resume, skills, or career..."}
                value={kittyInput}
                onChange={(e) => setKittyInput(e.target.value)}
                disabled={kittyLoading}
                aria-label="Message Kitty"
              />
              <button
                type="submit"
                className="kitty-send-btn"
                disabled={kittyLoading || !kittyInput.trim()}
                aria-label="Send message"
              >
                {kittyLoading ? <LoaderCircle className="spin" size={15} /> : <Send size={15} />}
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}

export default Workspace

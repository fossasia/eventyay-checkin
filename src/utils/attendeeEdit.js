const POSITION_FIELD_KEYS = new Set(['attendee_email', 'company', 'job_title'])

const STANDARD_POPUP_FIELD_KEYS = new Set(['company', 'job_title', 'attendee_email', 'seat'])

const CHOICE_QUESTION_TYPES = new Set(['C', 'L', 'M'])

export function isQuestionFieldKey(fieldKey) {
  return String(fieldKey || '').startsWith('question_')
}

export function questionIdFromFieldKey(fieldKey) {
  if (!isQuestionFieldKey(fieldKey)) {
    return null
  }
  const parsed = Number.parseInt(String(fieldKey).slice('question_'.length), 10)
  return Number.isFinite(parsed) ? parsed : null
}

export function normalizeDisplayPopupFieldKey(fieldKey) {
  const key = String(fieldKey || '').trim()
  if (!key || key === 'attendee_name') {
    return null
  }
  if (STANDARD_POPUP_FIELD_KEYS.has(key)) {
    return key
  }
  if (key.startsWith('question_')) {
    return key
  }
  if (/^\d+$/.test(key)) {
    return `question_${key}`
  }
  return null
}

export function normalizeDisplayPopupFields(displayFieldKeys = []) {
  const normalized = []
  for (const fieldKey of displayFieldKeys) {
    const key = normalizeDisplayPopupFieldKey(fieldKey)
    if (key && !normalized.includes(key)) {
      normalized.push(key)
    }
  }
  return normalized
}

function findAnswerByQuestionId(answers, questionId) {
  return (answers || []).find((item) => String(item.question) === String(questionId)) || null
}

function findAnswerByIdentifier(answers, identifier) {
  return (answers || []).find((item) => item.question_identifier === identifier) || null
}

function readStandardFieldValue(fieldKey, message = {}) {
  if (fieldKey === 'attendee_email') {
    return message.attendee_email || ''
  }
  if (fieldKey === 'company') {
    const answer = findAnswerByIdentifier(message.answers, 'company')
    if (answer) {
      return answer.answer || ''
    }
    return message.company || ''
  }
  if (fieldKey === 'job_title') {
    const answer = findAnswerByIdentifier(message.answers, 'job_title')
    if (answer) {
      return answer.answer || ''
    }
    return message.job_title || ''
  }
  return message[fieldKey] || ''
}

function readQuestionFieldValue(fieldKey, message = {}) {
  const questionId = questionIdFromFieldKey(fieldKey)
  if (!questionId) {
    return ''
  }
  const answer = findAnswerByQuestionId(message.answers, questionId)
  return answer?.answer || ''
}

export function buildEditableAttendeeState(message = {}, displayFieldKeys = []) {
  const state = {
    attendee_name: message.attendee_name || message.attendee || '',
    fields: {}
  }

  const fieldKeys = getAttendeeEditFieldKeys(displayFieldKeys).filter((fieldKey) => fieldKey !== 'attendee_name')
  for (const fieldKey of fieldKeys) {
    if (isQuestionFieldKey(fieldKey)) {
      state.fields[fieldKey] = readQuestionFieldValue(fieldKey, message)
    } else if (POSITION_FIELD_KEYS.has(fieldKey)) {
      state.fields[fieldKey] = readStandardFieldValue(fieldKey, message)
    }
  }

  return state
}

export function getAttendeeEditFieldKeys(displayFieldKeys = []) {
  const keys = ['attendee_name']
  for (const fieldKey of normalizeDisplayPopupFields(displayFieldKeys)) {
    if (!keys.includes(fieldKey)) {
      keys.push(fieldKey)
    }
  }
  return keys
}

function isChoiceQuestion(question) {
  const type = String(question?.type || '').toUpperCase()
  return CHOICE_QUESTION_TYPES.has(type)
}

function buildAnswerPatchEntry(fieldKey, value, questionsById, answers = []) {
  if (isQuestionFieldKey(fieldKey)) {
    const questionId = questionIdFromFieldKey(fieldKey)
    const question = questionsById[questionId]
    if (!questionId) {
      return null
    }
    if (isChoiceQuestion(question)) {
      const option = (question.options || []).find(
        (entry) => String(entry.answer) === String(value) || String(entry.id) === String(value)
      )
      if (!option) {
        return null
      }
      return {
        question: questionId,
        answer: option.answer,
        options: [option.id]
      }
    }
    return {
      question: questionId,
      answer: value,
      options: []
    }
  }

  const answer = findAnswerByIdentifier(answers, fieldKey)
  if (answer) {
    return {
      question: answer.question,
      answer: value,
      options: answer.options || []
    }
  }

  return null
}

export function buildAttendeePatchPayload(editable, original, displayFieldKeys, questionsById = {}) {
  const payload = {}
  const answerUpdates = []
  const editableFieldKeys = getAttendeeEditFieldKeys(displayFieldKeys).filter(
    (fieldKey) => fieldKey !== 'attendee_name'
  )

  if (editable.attendee_name !== original.attendee_name) {
    payload.attendee_name = editable.attendee_name
  }

  for (const fieldKey of editableFieldKeys) {
    const nextValue = editable.fields[fieldKey]
    const previousValue = original.fields[fieldKey]
    if (nextValue === previousValue) {
      continue
    }

    if (isQuestionFieldKey(fieldKey) || findAnswerByIdentifier(original._answers, fieldKey)) {
      const answerEntry = buildAnswerPatchEntry(
        fieldKey,
        nextValue,
        questionsById,
        original._answers || []
      )
      if (answerEntry) {
        answerUpdates.push(answerEntry)
      }
      continue
    }

    if (POSITION_FIELD_KEYS.has(fieldKey)) {
      payload[fieldKey] = nextValue
    }
  }

  if (answerUpdates.length > 0) {
    payload.answers = answerUpdates
  }

  return payload
}

export function indexQuestionsById(questions = []) {
  const byId = {}
  for (const question of questions) {
    if (question?.id != null) {
      byId[question.id] = question
    }
  }
  return byId
}

function readLocalizedText(value, fallback = '') {
  if (!value) {
    return fallback
  }
  if (typeof value === 'string') {
    return value
  }
  if (typeof value === 'object') {
    return value.en || value[Object.keys(value)[0]] || fallback
  }
  return String(value)
}

export function questionLabelForField(fieldKey, questionsById, fallbackLabels = {}) {
  const normalizedKey = normalizeDisplayPopupFieldKey(fieldKey) || fieldKey
  if (fallbackLabels[normalizedKey]) {
    return readLocalizedText(fallbackLabels[normalizedKey], fallbackLabels[normalizedKey])
  }
  if (isQuestionFieldKey(normalizedKey)) {
    const questionId = questionIdFromFieldKey(normalizedKey)
    const question = questionsById[questionId]
    return readLocalizedText(question?.question, readLocalizedText(question?.help_text, 'Field'))
  }
  const labels = {
    attendee_email: 'Email',
    company: 'Company',
    job_title: 'Job title',
    seat: 'Seat'
  }
  return labels[normalizedKey] || normalizedKey
}

export function readPopupFieldValue(fieldKey, message = {}) {
  const key = normalizeDisplayPopupFieldKey(fieldKey)
  if (!key) {
    return ''
  }
  if (key === 'company') {
    return readStandardFieldValue('company', message)
  }
  if (key === 'job_title') {
    return readStandardFieldValue('job_title', message)
  }
  if (key === 'attendee_email') {
    return readStandardFieldValue('attendee_email', message)
  }
  if (key === 'seat') {
    return message.seat || ''
  }
  if (isQuestionFieldKey(key)) {
    return readQuestionFieldValue(key, message)
  }
  return ''
}

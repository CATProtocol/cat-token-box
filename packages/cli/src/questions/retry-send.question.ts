import { Question, QuestionSet } from 'nest-commander';

export interface RetrySendQuestionAnswers {
  retry: 'abort' | 'retry';
}
@QuestionSet({ name: 'retry_send_question' })
export class RetryQuestions {
  @Question({
    message:
      'You may have unconfirmed transactions. Wait for the transaction to be confirmed and try again ? (default: abort)',
    name: 'retry',
    type: 'list',
    choices: ['abort', 'retry'],
  })
  async parseRetry(val: string) {
    return val;
  }
}

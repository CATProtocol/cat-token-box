import { Question, QuestionSet } from 'nest-commander';

export interface BurnConfirmQuestionAnswers {
  confirm: boolean;
}
@QuestionSet({ name: 'burn_confirm_question' })
export class BurnConfirmQuestion {
  @Question({
    message: 'Are you sure to burn tokens ? (default: no)',
    name: 'confirm',
    type: 'confirm',
    default: false,
  })
  async parseConfirm() {
    return true;
  }
}

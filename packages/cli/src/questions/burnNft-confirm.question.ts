import { Question, QuestionSet } from 'nest-commander';

export interface BurnNftConfirmQuestionAnswers {
  confirm: boolean;
}
@QuestionSet({ name: 'burnNft_confirm_question' })
export class BurnNftConfirmQuestion {
  @Question({
    message: 'Are you sure to burn Nft ? (default: no)',
    name: 'confirm',
    type: 'confirm',
    default: false,
  })
  async parseConfirm() {
    return true;
  }
}

export function redirectToUserAuth() {
  void import('@/router').then(({ default: router }) => {
    if (router.currentRoute.value.name !== 'userAuth') {
      void router.push({ name: 'userAuth' })
    }
  })
}

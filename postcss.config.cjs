// Vue CLI ran every stylesheet through autoprefixer against the browserslist
// block in package.json; Vite only does so when a PostCSS config is present,
// so this keeps the shipped CSS the same. It matters on iOS: `user-select`
// (the game screens and buttons) and friends still need their -webkit- twins
// in Safari, and those were only ever there because of this pass.
module.exports = {
  plugins: {
    autoprefixer: {},
  },
};

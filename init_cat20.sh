pkg_name=your_project_name
mnemonic=your_mnemonic
path_index=your_path_index
git clone https://github.com/ThreeAndTwo/cat-token-box $pkg_name
cd $pkg_name
yarn install
yarn build
sudo chmod 777 packages/tracker/docker/data
sudo chmod 777 packages/tracker/docker/pgdata

cd packages/cli 
cat config.json
yarn cli wallet create -m "$mnemonic" -p $path_index
chmod +x script.sh
yarn cli wallet address
yarn cli wallet balances

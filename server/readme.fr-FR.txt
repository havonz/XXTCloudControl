Si aucun fichier de configuration n’existe, le serveur en crée un nouveau et démarre avec un mot de passe aléatoire.
Le mot de passe aléatoire n’est affiché qu’une seule fois. Si vous l’oubliez, modifiez-le avec la commande suivante :
./xxtcloudserver-<platform>-<arch> -set-password <password>

Exemple pour Windows x64 :
xxtcloudserver-windows-amd64.exe -set-password 12345678

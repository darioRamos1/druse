namespace Druse.Domain;

/// <summary>
/// Las claves de catálogo que el backend manda al frontend.
///
/// Son constantes y no cadenas sueltas por dos razones: el compilador caza las
/// erratas, y `MessageKeysTests` las compara una a una contra
/// `frontend/src/i18n/es.json`. Esa prueba es lo que une los dos lados del
/// repositorio: una clave que se escriba aquí y no exista allí no llega a la
/// rama principal, y el usuario nunca ve una clave cruda en pantalla.
/// </summary>
public static class MessageKeys
{
    /// <summary>Lo que se comprueba de un perfil antes de intentar conectarse.</summary>
    public static class Connection
    {
        public const string Required = "server.connection.required";
        public const string Name = "server.connection.name";
        public const string NameTooLong = "server.connection.nameTooLong";
        public const string Host = "server.connection.host";
        public const string Port = "server.connection.port";
        public const string DatabaseFile = "server.connection.databaseFile";
        public const string Database = "server.connection.database";
        public const string Username = "server.connection.username";
        public const string Authentication = "server.connection.authentication";
        public const string WindowsOnSqlServer = "server.connection.windowsOnSqlServer";
        public const string WindowsOnWindows = "server.connection.windowsOnWindows";
        public const string Engine = "server.connection.engine";
        public const string InformixServer = "server.connection.informixServer";
        public const string Timeout = "server.connection.timeout";
    }

    /// <summary>Lo que se comprueba de un proveedor de IA antes de preguntarle nada.</summary>
    public static class AiProvider
    {
        public const string Required = "server.ai.required";
        public const string Name = "server.ai.name";
        public const string NameTooLong = "server.ai.nameTooLong";
        public const string Command = "server.ai.command";
        public const string UnknownCommand = "server.ai.unknownCommand";
        public const string Model = "server.ai.model";
        public const string BaseUrl = "server.ai.baseUrl";
        public const string BaseUrlScheme = "server.ai.baseUrlScheme";
        public const string BaseUrlPath = "server.ai.baseUrlPath";
    }

    /// <summary>
    /// Cómo se llama cada cosa del diseñador dentro de una frase.
    ///
    /// Van aparte porque se usan como parámetro: «El nombre de {cosa} es
    /// obligatorio» es una sola frase para las siete. Llevan el artículo dentro
    /// porque en español el artículo es parte del nombre.
    /// </summary>
    public static class Thing
    {
        public const string Table = "server.thing.table";
        public const string Column = "server.thing.column";
        public const string Index = "server.thing.index";
        public const string IndexColumn = "server.thing.indexColumn";
        public const string Constraint = "server.thing.constraint";
        public const string UniqueConstraint = "server.thing.uniqueConstraint";
        public const string CheckConstraint = "server.thing.checkConstraint";
        public const string ConstraintColumn = "server.thing.constraintColumn";
        public const string PrimaryKey = "server.thing.primaryKey";
        public const string ForeignKey = "server.thing.foreignKey";
        public const string ForeignKeyColumn = "server.thing.foreignKeyColumn";
        public const string ReferencedTable = "server.thing.referencedTable";
    }

    /// <summary>Lo que se comprueba de una tabla antes de escribir su DDL.</summary>
    public static class Table
    {
        public const string Required = "server.table.required";
        public const string AlterationRequired = "server.table.alterationRequired";
        public const string NoColumns = "server.table.noColumns";
        public const string NoChanges = "server.table.noChanges";
        public const string SingleIdentity = "server.table.singleIdentity";
        public const string DuplicatedColumns = "server.table.duplicatedColumns";
        public const string ColumnType = "server.table.columnType";
        public const string PrimaryKeyNullable = "server.table.primaryKeyNullable";
        public const string AlterAndDrop = "server.table.alterAndDrop";
        public const string PrimaryKeyColumns = "server.table.primaryKeyColumns";
        public const string PrimaryKeyDropped = "server.table.primaryKeyDropped";
        public const string IndexColumns = "server.table.indexColumns";
        public const string IndexRepeats = "server.table.indexRepeats";
        public const string IndexIncluded = "server.table.indexIncluded";
        public const string IndexFilter = "server.table.indexFilter";
        public const string IndexMethod = "server.table.indexMethod";
        public const string DuplicatedIndexes = "server.table.duplicatedIndexes";
        public const string ForeignKeyColumns = "server.table.foreignKeyColumns";
        public const string ForeignKeyMismatch = "server.table.foreignKeyMismatch";
        public const string UniqueColumns = "server.table.uniqueColumns";
        public const string CheckBody = "server.table.checkBody";
        public const string ChecksUnsupported = "server.table.checksUnsupported";
        public const string UnknownColumns = "server.table.unknownColumns";
        public const string NameRequired = "server.table.nameRequired";
        public const string NameNewline = "server.table.nameNewline";
        public const string NameTooLong = "server.table.nameTooLong";
    }

    /// <summary>Lo que se dice de una sesión o de un motor que no atiende.</summary>
    public static class Session
    {
        public const string NotOpen = "server.session.notOpen";
        public const string UnsupportedEngine = "server.session.unsupportedEngine";
        public const string CannotCreateDatabase = "server.session.cannotCreateDatabase";
    }

    /// <summary>El servidor intermedio, que es otra máquina y otros errores.</summary>
    public static class Tunnel
    {
        public const string Host = "server.tunnel.host";
        public const string Port = "server.tunnel.port";
        public const string Username = "server.tunnel.username";
        public const string Authentication = "server.tunnel.authentication";
        public const string PrivateKey = "server.tunnel.privateKey";
        public const string Timeout = "server.tunnel.timeout";
        public const string NotConfigured = "server.tunnel.notConfigured";
        public const string ForwardTimeout = "server.tunnel.forwardTimeout";
        public const string ForwardRefused = "server.tunnel.forwardRefused";
    }

    /// <summary>Reportes BI: actualizar, unir, programar, plantillas y exportar.</summary>
    public static class Reports
    {
        public const string Canceled = "server.reports.canceled";
        public const string SourceUnreadable = "server.reports.sourceUnreadable";
        public const string SourceTruncated = "server.reports.sourceTruncated";
        public const string NewerResult = "server.reports.newerResult";
        public const string Interrupted = "server.reports.interrupted";
        public const string Busy = "server.reports.busy";
        public const string Quota = "server.reports.quota";
        public const string TooLarge = "server.reports.tooLarge";
        public const string ReadOnlyQuery = "server.reports.readOnlyQuery";
        public const string NoResultSet = "server.reports.noResultSet";
        public const string SingleResultSet = "server.reports.singleResultSet";
        public const string JoinNeedsSources = "server.reports.joinNeedsSources";
        public const string JoinTruncated = "server.reports.joinTruncated";
        public const string JoinNoKeys = "server.reports.joinNoKeys";
        public const string JoinTypesDiffer = "server.reports.joinTypesDiffer";
        public const string JoinNeedsConversion = "server.reports.joinNeedsConversion";
        public const string JoinColumnMissing = "server.reports.joinColumnMissing";
        public const string JoinRightDuplicates = "server.reports.joinRightDuplicates";
        public const string JoinLeftDuplicates = "server.reports.joinLeftDuplicates";
        public const string DatasetName = "server.reports.datasetName";
        public const string SourceCount = "server.reports.sourceCount";
        public const string SourceAlias = "server.reports.sourceAlias";
        public const string SourceConnection = "server.reports.sourceConnection";
        public const string SourceMode = "server.reports.sourceMode";
        public const string SourceSql = "server.reports.sourceSql";
        public const string SourceVisual = "server.reports.sourceVisual";
        public const string DistinctAliases = "server.reports.distinctAliases";
        public const string JoinKeys = "server.reports.joinKeys";
        public const string JoinKind = "server.reports.joinKind";
        public const string JoinPair = "server.reports.joinPair";
        public const string JoinTwoSources = "server.reports.joinTwoSources";
        public const string ScheduleFrequency = "server.reports.scheduleFrequency";
        public const string ScheduleTime = "server.reports.scheduleTime";
        public const string ScheduleDay = "server.reports.scheduleDay";
        public const string ScheduleDays = "server.reports.scheduleDays";
        public const string ScheduleZone = "server.reports.scheduleZone";
        public const string ReportInvalid = "server.reports.reportInvalid";
        public const string ReportDatasetMissing = "server.reports.reportDatasetMissing";
        public const string DashboardInvalid = "server.reports.dashboardInvalid";
        public const string TemplateScope = "server.reports.templateScope";
        public const string TemplateName = "server.reports.templateName";
        public const string TemplateDescription = "server.reports.templateDescription";
        public const string TemplateSize = "server.reports.templateSize";
        public const string TemplateInvalid = "server.reports.templateInvalid";
        public const string TemplateForbidden = "server.reports.templateForbidden";
        public const string ExportEmpty = "server.reports.exportEmpty";
        public const string ExportPanels = "server.reports.exportPanels";
        public const string ExportDataset = "server.reports.exportDataset";
        public const string ExportTable = "server.reports.exportTable";
        public const string ExportCells = "server.reports.exportCells";
    }
}
